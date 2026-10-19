import 'reflect-metadata';

jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/nostr.provider',
  () => ({
    NostrProvider: class {
      identifier = 'nostr';
    },
  })
);

import { IntegrationManager, socialIntegrationList } from './integration.manager';
import { buildTemporalWorkers } from '../temporal/temporal.module';

describe('IntegrationManager.getProviderCredentials', () => {
  it('reutiliza a credencial Google do YouTube no GMB', async () => {
    const credentialService = {
      getRawShared: jest
        .fn()
        .mockImplementation(
          async (
            _organizationId: string,
            provider: string,
            _profileId?: string
          ) =>
            provider === 'youtube'
              ? {
                  clientId: 'google-client-id',
                  clientSecret: 'google-client-secret',
                }
              : undefined
        ),
    };
    const manager = new IntegrationManager(credentialService as any);

    await expect(
      manager.getProviderCredentials('gmb', 'org-1', 'profile-1')
    ).resolves.toEqual({
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
    expect(credentialService.getRawShared).toHaveBeenCalledWith(
      'org-1',
      'youtube',
      'profile-1'
    );
  });
});


describe('IntegrationManager provider registry', () => {
  it('starts one worker per registered provider without omitting any queue', () => {
    const identifiers = new IntegrationManager().getAllowedSocialsIntegrations();
    expect(new Set(identifiers).size).toBe(identifiers.length);

    const workers = buildTemporalWorkers({
      workflowsPath: '/workflows/index.js',
      activityClasses: [class TestActivity {}],
      integrations: socialIntegrationList,
    });
    const queues = workers.map((worker) => worker.taskQueue);
    expect(new Set(queues).size).toBe(queues.length);
    expect(queues).toEqual([
      'main',
      ...identifiers.filter((identifier) => !identifier.includes('-')),
      'email',
      'email-bulk',
    ]);
  });
});
