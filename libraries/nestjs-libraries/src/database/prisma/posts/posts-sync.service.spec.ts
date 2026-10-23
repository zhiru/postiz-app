jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [],
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
import { PostsSyncService } from './posts-sync.service';
import { Test } from '@nestjs/testing';

describe('post synchronization service', () => {
  const integration: any = {
    id: 'channel',
    organizationId: 'org',
    providerIdentifier: 'supported-provider',
    internalId: 'profile',
    token: 'private-token',
    postsSyncCursor: 'resume',
    postsSyncCompletedAt: null,
  };
  let repository: any,
    provider: any,
    posts: any,
    start: jest.Mock,
    service: PostsSyncService;
  beforeEach(() => {
    repository = {
      get: jest.fn().mockResolvedValue(integration),
      update: jest.fn().mockResolvedValue({ count: 1 }),
    };
    provider = {
      listPublishedPosts: jest
        .fn()
        .mockResolvedValue({ posts: [{ id: 'remote' }], nextCursor: 'next' }),
    };
    posts = { importPlatformPost: jest.fn().mockResolvedValue(true) };
    start = jest.fn().mockResolvedValue({});
    service = new PostsSyncService(
      repository,
      posts,
      { getSocialIntegration: () => provider } as any,
      { client: { getRawClient: () => ({ workflow: { start } }) } } as any,
      {} as any
    );
  });

  it('reads active Stories on every first-page refresh without altering workflow parameters', async () => {
    provider.listActiveStories = jest.fn().mockResolvedValue({
      posts: [{ id: 'story', settings: { post_type: 'story' } }],
    });
    await service.page('org', 'channel', false);
    expect(posts.importPlatformPost).toHaveBeenCalledWith(
      'org',
      'channel',
      { id: 'story', settings: { post_type: 'story' } },
      undefined
    );
    expect(start).not.toHaveBeenCalled();
    provider.listActiveStories.mockClear();
    await service.page('org', 'channel', true, 'resume');
    expect(provider.listActiveStories).not.toHaveBeenCalled();
  });
  it('preserves feed synchronization when the Story edge is unavailable', async () => {
    provider.listActiveStories = jest
      .fn()
      .mockRejectedValue(new Error('secret'));
    await expect(service.page('org', 'channel', false)).resolves.toMatchObject({
      imported: 1,
    });
    expect(posts.importPlatformPost).toHaveBeenCalledWith(
      'org',
      'channel',
      { id: 'remote' },
      undefined
    );
  });
  it('does not expose channels belonging to another organization', async () => {
    repository.get.mockResolvedValue(null);
    await expect(service.request('other-org', 'channel')).rejects.toThrow(
      'Channel not found'
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('uses one workflow identity for manual and automatic requests', async () => {
    await service.request('org', 'channel');
    expect(start.mock.calls[0][1]).toMatchObject({
      workflowId: 'external-posts-sync-v1-channel',
      args: [{ organizationId: 'org', id: 'channel' }],
    });
    const duplicate = new Error();
    duplicate.name = 'WorkflowExecutionAlreadyStartedError';
    start.mockRejectedValue(duplicate);
    await expect(service.request('org', 'channel')).resolves.toEqual({
      queued: true,
    });
    expect(JSON.stringify(start.mock.calls)).not.toContain('private-token');
  });

  it('resumes history initially and selects recent refresh after completion', async () => {
    await expect(service.prepare('org', 'channel')).resolves.toEqual({
      full: true,
      cursor: 'resume',
    });
    repository.get.mockResolvedValue({
      ...integration,
      postsSyncCompletedAt: new Date(),
    });
    await expect(service.prepare('org', 'channel')).resolves.toEqual({
      full: false,
      cursor: undefined,
    });
  });

  it('checkpoints a full page only after every post was imported', async () => {
    await expect(
      service.page('org', 'channel', true, 'resume')
    ).resolves.toEqual({ imported: 1, nextCursor: 'next' });
    expect(provider.listPublishedPosts).toHaveBeenCalledWith(
      'profile',
      'private-token',
      'resume'
    );
    expect(posts.importPlatformPost).toHaveBeenCalledWith(
      'org',
      'channel',
      {
        id: 'remote',
      },
      undefined
    );
    expect(repository.update).toHaveBeenCalledWith('org', 'channel', {
      postsSyncCursor: 'next',
    });
    repository.update.mockClear();
    posts.importPlatformPost.mockRejectedValue(
      new Error('database unavailable')
    );
    await expect(
      service.page('org', 'channel', true, 'resume')
    ).rejects.toThrow('database unavailable');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not overwrite the history cursor during recent refreshes', async () => {
    await service.page('org', 'channel', false);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('reports fixed safe errors without saving provider responses', async () => {
    await service.failed('org', 'channel');
    expect(repository.update.mock.calls[0][2]).toMatchObject({
      postsSyncRunningSince: null,
      postsSyncCursor: null,
    });
    expect(JSON.stringify(repository.update.mock.calls)).not.toContain(
      'private-token'
    );
  });

  it('marks recurrence history covered only for publication types supported by the provider', async () => {
    provider.canImportPublishedPost = (settings: any) =>
      settings.post_type !== 'story';
    posts.getRecurringSyncCandidates = jest.fn().mockResolvedValue([
      { id: 'feed-root', settings: '{"post_type":"post"}' },
      { id: 'story-root', settings: '{"post_type":"story"}' },
    ]);
    posts.coverRecurringHistory = jest.fn();
    await service.finish('org', 'channel', true);
    expect(posts.coverRecurringHistory).toHaveBeenCalledWith('org', 'channel', [
      'feed-root',
    ]);
  });

  it('registers the scheduler after Temporal onModuleInit has initialized the client', async () => {
    let ready = false;
    const previous = process.env.RUN_CRON;
    process.env.RUN_CRON = '1';
    const sync = new PostsSyncService(
      repository,
      posts,
      {} as any,
      {
        client: {
          getRawClient: () => (ready ? { workflow: { start } } : null),
        },
      } as any,
      {} as any
    );
    const app = await Test.createTestingModule({
      providers: [
        { provide: PostsSyncService, useValue: sync },
        {
          provide: 'temporal-client',
          useValue: {
            onModuleInit: () => {
              ready = true;
            },
          },
        },
      ],
    }).compile();
    try {
      await app.init();
      expect(start).toHaveBeenCalledWith(
        'scheduleExternalPostsSyncV1',
        expect.objectContaining({
          workflowId: 'external-posts-sync-scheduler-v1',
        })
      );
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.RUN_CRON;
      else process.env.RUN_CRON = previous;
    }
  });
});
