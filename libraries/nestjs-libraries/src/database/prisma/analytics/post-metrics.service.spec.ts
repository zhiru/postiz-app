jest.mock('../notifications/notification.service', () => ({
  NotificationService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [{ identifier: 'test', postAnalytics: () => {} }],
}));
import { createMock } from '@gitroom/nestjs-libraries/test';
import {
  PostMetricsService,
  normalizePostMetrics,
  engagementRate,
} from './post-metrics.service';
import { PostMetricsRepository } from './post-metrics.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { NotificationService } from '../notifications/notification.service';
const mockLocks = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async () => null),
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && mockLocks.has(key)) return null;
      mockLocks.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async () => 1),
    eval: jest.fn(async (_script, _n, key, token) => {
      if (mockLocks.get(key) === token) mockLocks.delete(key);
    }),
  },
}));
afterEach(() => mockLocks.clear());
const make = () => {
  const repo = createMock<PostMetricsRepository>();
  const providers = createMock<IntegrationManager>();
  const notifications = createMock<NotificationService>();
  const encryption = createMock<EncryptionService>();
  const service = new PostMetricsService(
    repo,
    providers,
    encryption,
    notifications
  );
  const post: any = {
    id: 'p',
    organizationId: 'o',
    profileId: 'a',
    integrationId: 'i',
    releaseId: 'remote',
    state: 'PUBLISHED',
    settings: '{}',
    publishDate: new Date(),
    integration: {
      id: 'i',
      organizationId: 'o',
      profileId: 'a',
      token: 'plain-token',
      providerIdentifier: 'test',
      internalId: 'account',
    },
  };
  repo.forCollection.mockResolvedValue(post);
  repo.latestAttempt.mockResolvedValue(null);
  repo.record.mockImplementation(async (row: any) => row);
  return { repo, providers, notifications, service, post };
};
describe('PostMetricsService', () => {
  it('keeps absent values unknown and real zero, with an explicit denominator', () => {
    const metrics = normalizePostMetrics([
      { label: 'Views', data: [{ total: '30', date: '2026-10-23' }] },
      { label: 'Likes', data: [{ total: '0', date: '2026-10-23' }] },
    ] as any);
    expect(metrics.views).toBe(30);
    expect(metrics.reactions).toBe(0);
    expect(metrics.comments).toBeNull();
    expect(metrics.impressions).toBeNull();
    expect(engagementRate(metrics)).toMatchObject({
      value: null,
      denominator: 'views',
    });
    expect(engagementRate({ ...metrics, comments: 3 })).toMatchObject({
      value: 10,
      formula: '(reactions + comments) / views * 100',
    });
  });
  it('returns scoped local data without any provider calls', async () => {
    const { service, repo, providers } = make();
    repo.list.mockResolvedValue([]);
    const result = await service.listPosts('o', { date: 30 }, 'a');
    expect(repo.list).toHaveBeenCalledWith('o', expect.any(Object), 'a');
    expect(result.total).toBe(0);
    expect(providers.getSocialIntegration).not.toHaveBeenCalled();
  });
  it('stores observed snapshots and never changes publication state', async () => {
    const { service, repo, providers } = make();
    const analytics = jest.fn(async () => [
      { label: 'Likes', data: [{ total: '5', date: '2026-10-23' }] },
    ]);
    providers.getSocialIntegration.mockReturnValue({
      postAnalytics: analytics,
    } as any);
    await service.refresh('o', 'p', 'a', true);
    expect(repo.forCollection).toHaveBeenCalledWith('o', 'p', 'a');
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'o',
        profileId: 'a',
        postId: 'p',
        status: 'available',
        metrics: expect.objectContaining({ reactions: 5 }),
      })
    );
  });
  it('preserves previous metrics and records a sanitized failure instead of publishing again', async () => {
    const { service, repo, providers, notifications } = make();
    providers.getSocialIntegration.mockReturnValue({
      postAnalytics: jest
        .fn()
        .mockRejectedValue(new Error('secret=do-not-leak')),
    } as any);
    const result = await service.refresh('o', 'p', 'a', true);
    expect(result.status).toBe('transient_error');
    expect(JSON.stringify(repo.record.mock.calls)).not.toContain('do-not-leak');
    expect(notifications.inAppNotification).toHaveBeenCalledWith(
      'o',
      expect.objectContaining({
        profileId: 'a',
        messageKey: 'notif_post_metrics_unavailable',
      }),
      false
    );
  });
  it('rejects posts outside the authenticated profile before requesting metrics', async () => {
    const { service, repo, providers } = make();
    repo.forCollection.mockResolvedValue(null);
    await expect(service.refresh('o', 'p', 'other', true)).rejects.toThrow();
    expect(providers.getSocialIntegration).not.toHaveBeenCalled();
  });
  it('does not request expired Story insights or invent zeros', async () => {
    const { service, post, repo, providers } = make();
    post.settings = '{"post_type":"story"}';
    post.publishDate = new Date(Date.now() - 2 * 86400000);
    providers.getSocialIntegration.mockReturnValue({
      storyInsightsWindowHours: 24,
    } as any);
    await service.refresh('o', 'p', 'a', true);
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'window_expired' })
    );
  });
  it('shares a per-post lease between manual and scheduled requests', async () => {
    const { service, providers } = make();
    let resolve: any;
    const analytics = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    providers.getSocialIntegration.mockReturnValue({
      postAnalytics: analytics,
    } as any);
    const first = service.refresh('o', 'p', 'a', true);
    await new Promise((r) => setImmediate(r));
    const second = await service.refresh('o', 'p', undefined, false);
    expect(second.status).toBe('in_progress');
    resolve([]);
    await first;
    expect(analytics).toHaveBeenCalledTimes(1);
  });
});

it('advances history cursor when its batch overlaps the recent batch', async () => {
  const { service, repo } = make();
  repo.recentToCollect.mockResolvedValue([
    { id: 'p', organizationId: 'o', profileId: 'a' },
  ] as any);
  repo.historyToCollect.mockResolvedValue([
    { id: 'p', organizationId: 'o', profileId: 'a' },
  ] as any);
  jest
    .spyOn(service, 'refresh')
    .mockResolvedValue({ status: 'cooldown' } as any);
  await service.collectBatch();
  const { ioRedis } = require('../../../redis/redis.service');
  expect(ioRedis.set).toHaveBeenCalledWith(
    'post-metrics-history-cursor-v1',
    'p'
  );
  expect(service.refresh).toHaveBeenCalledTimes(1);
});
it('keeps provider reads out of MCP-style history queries and filters profile before returning observations', async () => {
  const { service, repo, providers } = make();
  repo.get.mockResolvedValue(null);
  await expect(service.getPost('o', 'foreign', 'a')).rejects.toThrow(
    'Published post not found'
  );
  expect(repo.history).not.toHaveBeenCalled();
  expect(providers.getSocialIntegration).not.toHaveBeenCalled();
});
it('does not return an incomplete summary when the report work limit is exceeded', async () => {
  const { service, repo } = make();
  repo.list.mockResolvedValue(new Array(5001).fill({}));
  await expect(service.listPosts('o', {}, 'a')).rejects.toThrow('5000');
});

it('reads durable metrics even when the provider refresh is in cooldown', async () => {
  const { service, repo } = make();
  repo.get.mockResolvedValue({
    id: 'p',
    integrationId: 'i',
    profileId: 'a',
    content: 'hello',
    publishDate: new Date(),
    releaseId: 'r',
    integration: { name: 'channel', providerIdentifier: 'test' },
    metricSnapshots: [
      {
        capturedAt: new Date(),
        source: 'provider',
        period: 'lifetime',
        metrics: { views: 0, reactions: 4 },
      },
    ],
  } as any);
  repo.latestAttempt.mockResolvedValue({
    status: 'available',
    capturedAt: new Date(),
  } as any);
  const result = await service.readMetrics('o', 'p', 'a');
  expect(result.metricsAvailable).toBe(true);
  expect(result.metrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: 'views',
        data: [expect.objectContaining({ total: '0' })],
      }),
    ])
  );
});
it('scopes Story webhook observations and preserves a pending identity before import', async () => {
  const { service, repo } = make();
  repo.storyChannels.mockResolvedValue([
    { id: 'i', organizationId: 'o', profileId: 'a' },
  ] as any);
  repo.storyPost.mockResolvedValue(null);
  await service.storyWebhook(
    'account',
    { media_id: 'remote', reach: 0, replies: 2 },
    ['o']
  );
  expect(repo.storyChannels).toHaveBeenCalledWith('account', ['o']);
  expect(repo.record).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: 'o',
      profileId: 'a',
      integrationId: 'i',
      postId: undefined,
      remoteId: 'remote',
      status: 'available',
      metrics: expect.objectContaining({ reach: 0, replies: 2, views: null }),
    })
  );
});

it('exports the full filtered set and escapes spreadsheet formula prefixes including leading whitespace', async () => {
  const { service } = make();
  jest
    .spyOn(service, 'listPosts')
    .mockResolvedValue({
      posts: [
        {
          id: 'p',
          channelName: ' \t=HYPERLINK("bad")',
          platform: 'test',
          format: 'story',
          publishDate: '2026-10-23T12:00:00Z',
          metrics: normalizePostMetrics([]),
          engagementRate: { value: null, denominator: null, formula: null },
          updatedAt: null,
          source: null,
          status: 'not_collected',
        },
      ],
    } as any);
  const csv = await service.csv('o', { page: 4, limit: 20 }, 'profile');
  expect(service.listPosts).toHaveBeenCalledWith(
    'o',
    expect.objectContaining({ page: 0, limit: Number.MAX_SAFE_INTEGER }),
    'profile'
  );
  expect(csv).toContain("' \t=HYPERLINK");
  expect(csv).toContain('engagementPercent');
});
