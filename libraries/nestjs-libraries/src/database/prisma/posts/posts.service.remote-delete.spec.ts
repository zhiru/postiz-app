jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/ai/ai-text.service', () => ({
  AiTextService: class AiTextServiceMock {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class OpenaiServiceMock {},
}));

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn().mockReturnValue({}) },
}));

import { CreationMethod } from '@prisma/client';
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class MediaServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class ShortLinkServiceMock {},
}));

import 'reflect-metadata';
import { PostsService } from './posts.service';
jest.mock('@gitroom/nestjs-libraries/crypto/integration-token.helper', () => ({
  decryptIntegrationToken: (_: unknown, value: string) => value,
}));
const setup = () => {
  const post = {
    id: 'post',
    profileId: 'profile',
    integrationId: 'channel',
    state: 'PUBLISHED',
    releaseId: '123',
    updatedAt: new Date('2026-10-23T12:00:00Z'),
    integration: { providerIdentifier: 'instagram' },
  };
  const repository = {
    getManagedPost: jest.fn().mockResolvedValue([post]),
    getRemoteDeletionReceipt: jest.fn().mockResolvedValue(null),
    reservePostOperation: jest.fn().mockResolvedValue({ claimed: true }),
    completePostOperation: jest.fn().mockResolvedValue({ id: 'receipt' }),
  };
  const provider = {
    checkRemoteDeletion: jest.fn().mockResolvedValue(undefined),
    deletePublishedPost: jest
      .fn()
      .mockResolvedValue({ success: true, deletedId: '123' }),
  };
  const integrations = {
    getIntegrationById: jest.fn().mockResolvedValue({
      profileId: 'profile',
      internalId: 'ig-owner',
      token: 'page___user',
      providerIdentifier: 'instagram',
    }),
  };
  const service = Object.create(PostsService.prototype) as PostsService;
  Object.assign(service, {
    _postRepository: repository,
    _integrationManager: { getSocialIntegration: () => provider },
    _integrationService: integrations,
    _encryption: {},
  });
  const input = {
    version: post.updatedAt.toISOString(),
    confirmRemoteId: '123',
  };
  return { service, repository, provider, integrations, post, input };
};
it('checks exact scoped record and ownership before claiming and deleting, preserving local history', async () => {
  const x = setup();
  expect(
    await x.service.deleteRemotePost('org', 'profile', 'post', x.input)
  ).toEqual({ status: 'deleted', remoteId: '123', localDeleted: false });
  expect(x.repository.getManagedPost).toHaveBeenCalledWith(
    'org',
    'profile',
    'post'
  );
  expect(x.provider.checkRemoteDeletion).toHaveBeenCalledWith(
    'ig-owner',
    'page___user',
    '123'
  );
  expect(x.repository.completePostOperation).toHaveBeenCalledWith(
    expect.stringContaining('org:profile:post:123'),
    expect.objectContaining({ status: 'deleted' })
  );
});
it('rejects stale versions, wrong remote IDs, drafts and missing records before remote calls', async () => {
  for (const kind of ['version', 'id', 'draft', 'missing']) {
    const x = setup();
    if (kind === 'version') x.input.version = '2026-10-22T12:00:00.000Z';
    if (kind === 'id') x.input.confirmRemoteId = '456';
    if (kind === 'draft') x.post.state = 'DRAFT';
    if (kind === 'missing') x.repository.getManagedPost.mockResolvedValue([]);
    await expect(
      x.service.deleteRemotePost('org', 'profile', 'post', x.input)
    ).rejects.toThrow();
    expect(x.provider.deletePublishedPost).not.toHaveBeenCalled();
  }
});
it('rejects a channel from another profile', async () => {
  const x = setup();
  x.integrations.getIntegrationById.mockResolvedValue({ profileId: 'other' });
  await expect(
    x.service.deleteRemotePost('org', 'profile', 'post', x.input)
  ).rejects.toThrow();
  expect(x.provider.deletePublishedPost).not.toHaveBeenCalled();
});
it('keeps access failures retryable without reserving or deleting', async () => {
  const x = setup();
  x.provider.checkRemoteDeletion.mockRejectedValue(new Error('permission'));
  await expect(
    x.service.deleteRemotePost('org', 'profile', 'post', x.input)
  ).rejects.toThrow();
  expect(x.repository.reservePostOperation).not.toHaveBeenCalled();
});
it('records an uncertain result without leaking errors and never repeats a claimed delete', async () => {
  const x = setup();
  x.provider.deletePublishedPost.mockRejectedValue(new Error('secret-token'));
  const result = await x.service.deleteRemotePost(
    'org',
    'profile',
    'post',
    x.input
  );
  expect(result.status).toBe('unknown');
  expect(JSON.stringify(result)).not.toContain('secret-token');
  x.repository.getRemoteDeletionReceipt.mockResolvedValue({
    result: JSON.stringify(result),
  });
  await x.service.deleteRemotePost('org', 'profile', 'post', x.input);
  expect(x.provider.deletePublishedPost).toHaveBeenCalledTimes(1);
});
it('does not send another delete when a concurrent request owns the receipt', async () => {
  const x = setup();
  x.repository.reservePostOperation.mockResolvedValue({ claimed: false });
  expect(
    (await x.service.deleteRemotePost('org', 'profile', 'post', x.input)).status
  ).toBe('unknown');
  expect(x.provider.deletePublishedPost).not.toHaveBeenCalled();
});

it('blocks a multi-story batch because only the final remote ID is retained', async () => {
  const x = setup();
  Object.assign(x.post, {
    settings: '{"post_type":"story"}',
    image: '[{"path":"one"},{"path":"two"}]',
  });
  await expect(
    x.service.deleteRemotePost('org', 'profile', 'post', x.input)
  ).rejects.toMatchObject({ status: 422 });
  expect(x.provider.deletePublishedPost).not.toHaveBeenCalled();
});
