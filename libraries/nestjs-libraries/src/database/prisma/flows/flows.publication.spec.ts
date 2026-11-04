// Mocks topo-de-modulo: FlowsService importa IntegrationManager (nostr.provider
// ESM-only que quebra ts-jest) e serviços que o puxam transitivamente. Nada
// disso é usado pelo caminho de configuração de DM.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service',
  () => ({ InstagramMessagingService: class InstagramMessagingServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service',
  () => ({ CredentialService: class CredentialServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service',
  () => ({ ProfileService: class ProfileServiceMock {} })
);

import { FlowsService } from './flows.service';

describe('Execution publication permalink', () => {
  const permalink = 'https://www.instagram.com/p/RealShortcode/';
  let service: FlowsService;
  let repo: any;
  let integrations: any;
  let provider: any;
  let messaging: any;
  beforeEach(() => {
    repo = {
      getExecution: jest.fn().mockResolvedValue({ igMediaId: '123' }),
      getExecutionPublicationContext: jest.fn().mockResolvedValue({
        integrationId: 'channel',
        profileId: 'profile',
        integration: {
          posts: [{ releaseURL: permalink }],
          unmatchedComments: [],
        },
      }),
    };
    integrations = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'channel',
        organizationId: 'org',
        profileId: 'profile',
        providerIdentifier: 'instagram-standalone',
        token: 'token',
        internalId: 'account',
      }),
    };
    provider = {
      getMediaMetadata: jest.fn().mockResolvedValue({ id: '123', permalink }),
    };
    messaging = { resolveIgUserToken: jest.fn().mockResolvedValue('ig-token') };
    service = new FlowsService(
      repo,
      null as any,
      integrations,
      { getSocialIntegration: () => provider } as any,
      null as any,
      messaging,
      null as any,
      {} as any,
      {} as any
    );
  });
  const resolve = () =>
    service.getExecutionPublication('org', 'flow', 'execution', 'profile');
  it('uses a stored permalink after checking execution and channel access', async () => {
    await expect(resolve()).resolves.toEqual({ permalink });
    expect(repo.getExecution).toHaveBeenCalledWith(
      'execution',
      'org',
      'flow',
      'profile'
    );
    expect(repo.getExecutionPublicationContext).toHaveBeenCalledWith(
      'org',
      'flow',
      '123',
      'profile'
    );
    expect(integrations.getIntegrationById).toHaveBeenCalledWith(
      'org',
      'channel'
    );
    expect(provider.getMediaMetadata).not.toHaveBeenCalled();
  });
  it('reuses inbox metadata when the calendar has no link', async () => {
    repo.getExecutionPublicationContext.mockResolvedValue({
      integrationId: 'channel',
      profileId: 'profile',
      integration: { posts: [], unmatchedComments: [{ permalink }] },
    });
    await expect(resolve()).resolves.toEqual({ permalink });
    expect(provider.getMediaMetadata).not.toHaveBeenCalled();
  });
  it('resolves older executions with the authorized standalone route', async () => {
    repo.getExecutionPublicationContext.mockResolvedValue({
      integrationId: 'channel',
      profileId: 'profile',
      integration: { posts: [], unmatchedComments: [] },
    });
    await expect(resolve()).resolves.toEqual({ permalink });
    expect(provider.getMediaMetadata).toHaveBeenCalledWith(
      '123',
      'token',
      'graph.instagram.com'
    );
  });
  it('uses the existing Facebook login credential resolver', async () => {
    const integration = await integrations.getIntegrationById();
    integration.providerIdentifier = 'instagram';
    repo.getExecutionPublicationContext.mockResolvedValue({
      integrationId: 'channel',
      profileId: 'profile',
      integration: { posts: [], unmatchedComments: [] },
    });
    await expect(resolve()).resolves.toEqual({ permalink });
    expect(messaging.resolveIgUserToken).toHaveBeenCalledWith(
      'org',
      'profile',
      'account'
    );
    expect(provider.getMediaMetadata).toHaveBeenCalledWith(
      '123',
      'ig-token',
      'graph.instagram.com'
    );
  });
  it('does not resolve inaccessible or missing executions', async () => {
    repo.getExecution.mockResolvedValue(null);
    await expect(resolve()).resolves.toEqual({ permalink: null });
    expect(repo.getExecutionPublicationContext).not.toHaveBeenCalled();
    expect(integrations.getIntegrationById).not.toHaveBeenCalled();
  });
  it('rejects a channel from another profile even when metadata exists', async () => {
    const integration = await integrations.getIntegrationById();
    integration.profileId = 'other';
    await expect(resolve()).rejects.toThrow(
      'Integracao pertence a outro perfil'
    );
    expect(provider.getMediaMetadata).not.toHaveBeenCalled();
  });
  it.each([
    'javascript:alert(1)',
    'http://www.instagram.com/p/real/',
    'https://instagram.com.evil.test/p/real/',
    'https://evil.test/p/real/',
    'https://user:password@instagram.com/p/real/',
    'https://instagram.com:8443/p/real/',
    'https://www.instagram.com/accounts/login/',
  ])('rejects unsafe stored and API URLs: %s', async (unsafe) => {
    const context = await repo.getExecutionPublicationContext();
    context.integration.posts[0].releaseURL = unsafe;
    provider.getMediaMetadata.mockResolvedValue({
      id: '123',
      permalink: unsafe,
    });
    await expect(resolve()).resolves.toEqual({ permalink: null });
  });
  it('does not construct a URL when the API has no permalink or returns another media', async () => {
    const context = await repo.getExecutionPublicationContext();
    context.integration.posts = [];
    provider.getMediaMetadata.mockResolvedValue({ id: '123' });
    await expect(resolve()).resolves.toEqual({ permalink: null });
    provider.getMediaMetadata.mockResolvedValue({ id: 'other', permalink });
    await expect(resolve()).resolves.toEqual({ permalink: null });
  });
  it('keeps metadata failure separate from execution history', async () => {
    const context = await repo.getExecutionPublicationContext();
    context.integration.posts = [];
    provider.getMediaMetadata.mockRejectedValue(new Error('expired'));
    await expect(resolve()).resolves.toEqual({ permalink: null });
    expect(repo.getExecution).toHaveBeenCalledTimes(1);
  });
});
