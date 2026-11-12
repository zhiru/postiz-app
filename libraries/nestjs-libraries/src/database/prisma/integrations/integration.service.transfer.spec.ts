jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn().mockReturnValue({}) },
}));

import { IntegrationService } from './integration.service';

const setup = (opts: {
  integration?: any;
  creds?: Record<string, any>;
  transfer?: any;
}) => {
  const repo = {
    getIntegrationById: jest
      .fn()
      .mockResolvedValue(
        'integration' in opts
          ? opts.integration
          : { id: 'int-1', profileId: 'p-1', providerIdentifier: 'x' }
      ),
    transferToProfile: jest
      .fn()
      .mockResolvedValue(opts.transfer ?? { id: 'int-1' }),
  };
  const manager = {
    getProviderCredentials: jest.fn(
      async (_p: string, _o: string, profileId?: string) =>
        opts.creds?.[profileId!]
    ),
  };
  const service = new IntegrationService(
    repo as any,
    {} as any,
    manager as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { repo, service };
};

describe('IntegrationService.transferToProfile', () => {
  it('moves the channel when both profiles resolve the same OAuth app', async () => {
    const same = { clientId: 'a', clientSecret: 's' };
    const { repo, service } = setup({ creds: { 'p-1': same, 'p-2': same } });
    await expect(service.transferToProfile('org-1', 'int-1', 'p-2')).resolves.toEqual({
      id: 'int-1',
    });
    expect(repo.transferToProfile).toHaveBeenCalledWith('org-1', 'int-1', 'p-2');
  });

  it('moves when neither profile has credentials', async () => {
    const { service } = setup({});
    await expect(service.transferToProfile('org-1', 'int-1', 'p-2')).resolves.toEqual({
      id: 'int-1',
    });
  });

  it('rejects an integration outside the organization or deleted', async () => {
    const { repo, service } = setup({ integration: null });
    await expect(service.transferToProfile('org-2', 'int-1', 'p-2')).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.transferToProfile).not.toHaveBeenCalled();
  });

  it('rejects moving to the profile it already belongs to', async () => {
    const { repo, service } = setup({});
    await expect(service.transferToProfile('org-1', 'int-1', 'p-1')).rejects.toMatchObject({
      status: 400,
    });
    expect(repo.transferToProfile).not.toHaveBeenCalled();
  });

  it('rejects when the destination uses another OAuth app, without leaking values', async () => {
    const { repo, service } = setup({
      creds: {
        'p-1': { clientId: 'client-A', clientSecret: 'secret-A' },
        'p-2': { clientId: 'client-B', clientSecret: 'secret-B' },
      },
    });
    const error: any = await service
      .transferToProfile('org-1', 'int-1', 'p-2')
      .catch((e) => e);
    expect(error.status).toBe(409);
    expect(JSON.stringify(error.message)).not.toMatch(/client-|secret-/);
    expect(repo.transferToProfile).not.toHaveBeenCalled();
  });

  it('maps a missing or deleted destination profile to 404', async () => {
    const { service } = setup({ transfer: { blocked: 'profile_not_found' } });
    await expect(service.transferToProfile('org-1', 'int-1', 'p-9')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('maps active repost rules to 409', async () => {
    const { service } = setup({ transfer: { blocked: 'repost_rules' } });
    await expect(service.transferToProfile('org-1', 'int-1', 'p-2')).rejects.toMatchObject({
      status: 409,
    });
  });
});
