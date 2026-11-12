jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn().mockReturnValue({}) },
}));

import { IntegrationRepository } from './integration.repository';

const setup = (opts: { profile?: any; repostRules?: number } = {}) => {
  const tx: any = {
    profile: {
      findFirst: jest
        .fn()
        .mockResolvedValue('profile' in opts ? opts.profile : { id: 'p-2' }),
    },
    repostRule: { count: jest.fn().mockResolvedValue(opts.repostRules ?? 0) },
    post: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    postMetricSnapshot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    statusEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    flow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    integration: { update: jest.fn().mockResolvedValue({ id: 'int-1' }) },
  };
  const transaction = { model: { $transaction: (fn: any) => fn(tx) } };
  const repo = new IntegrationRepository(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    transaction as any
  );
  return { repo, tx };
};

describe('IntegrationRepository.transferToProfile', () => {
  it('moves the integration and its profile-scoped rows in one transaction', async () => {
    const { repo, tx } = setup();
    await expect(repo.transferToProfile('org-1', 'int-1', 'p-2')).resolves.toEqual({
      id: 'int-1',
    });
    const scope = { where: { organizationId: 'org-1', integrationId: 'int-1' }, data: { profileId: 'p-2' } };
    for (const model of ['post', 'postMetricSnapshot', 'statusEvent', 'flow']) {
      expect(tx[model].updateMany).toHaveBeenCalledWith(scope);
    }
    expect(tx.integration.update).toHaveBeenCalledWith({
      select: { id: true },
      where: { id: 'int-1', organizationId: 'org-1' },
      data: { profileId: 'p-2' },
    });
  });

  it('only accepts a non-deleted profile of the same organization', async () => {
    const { repo, tx } = setup({ profile: null });
    await expect(repo.transferToProfile('org-1', 'int-1', 'p-9')).resolves.toEqual({
      blocked: 'profile_not_found',
    });
    expect(tx.profile.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-9', organizationId: 'org-1', deletedAt: null },
      select: { id: true },
    });
    expect(tx.integration.update).not.toHaveBeenCalled();
    expect(tx.post.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to move a channel used by an active repost rule', async () => {
    const { repo, tx } = setup({ repostRules: 1 });
    await expect(repo.transferToProfile('org-1', 'int-1', 'p-2')).resolves.toEqual({
      blocked: 'repost_rules',
    });
    expect(tx.integration.update).not.toHaveBeenCalled();
  });
});
