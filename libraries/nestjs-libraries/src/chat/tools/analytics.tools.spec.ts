jest.mock('../../database/prisma/analytics/post-metrics.service', () => ({
  PostMetricsService: class {},
}));
import {
  AnalyticsSummaryTool,
  AnalyticsPostsTool,
  AnalyticsPostTool,
} from './analytics.tools';
import { PostMetricsService } from '../../database/prisma/analytics/post-metrics.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
const post: any = {
  id: 'post',
  content: 'caption',
  publishDate: '2026-10-23T12:00:00Z',
  remoteId: 'remote',
  releaseURL: null,
  reviewURL: '/p/post',
  format: 'story',
  thumbnail: null,
  integrationId: 'i',
  channelName: 'channel',
  channelPicture: null,
  platform: 'instagram',
  metrics: { views: 0, comments: null },
  metricCollectedAt: {},
  metricSources: {},
  engagementRate: {
    value: null,
    denominator: 'views',
    denominatorValue: 0,
    formula: '(reactions + comments) / views * 100',
  },
  updatedAt: null,
  source: null,
  metricPeriod: 'unknown',
  status: 'not_collected',
  lastAttemptAt: null,
  nextRefreshAt: null,
  manualRefreshAfter: null,
};
const summary: any = {
  period: {
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-31T23:59:59Z',
    field: 'publishDate',
  },
  notes: { nullMeansUnknownNotZero: true },
  unit: 'count',
  total: 1,
  page: 0,
  limit: 20,
  summary: {
    posts: 1,
    availablePosts: 0,
    metrics: post.metrics,
    coverage: { views: { known: 1, total: 1 } },
  },
  channels: [{ id: 'i', name: 'channel', posts: 1 }],
  weekdays: [1, 0, 0, 0, 0, 0, 0],
};
describe('analytics MCP contracts', () => {
  it.each([
    [AnalyticsSummaryTool, 'analyticsSummaryTool', 'summary', {}],
    [
      AnalyticsPostsTool,
      'analyticsPostsTool',
      'listPosts',
      { date: 7, format: 'story' },
    ],
    [AnalyticsPostTool, 'analyticsPostTool', 'getPost', { id: 'post' }],
  ] as const)(
    'uses authenticated scope and read-only hints for %s',
    async (Ctor, name, method, input) => {
      const service = createMock<PostMetricsService>();
      const output: any =
        method === 'getPost'
          ? { post, notes: summary.notes, history: [], historyNextCursor: null }
          : method === 'listPosts'
          ? { ...summary, posts: [post], topReactions: [], topComments: [] }
          : summary;
      service[method].mockResolvedValue(output as any);
      const instance = new Ctor(service);
      const tool = instance.run() as any;
      expect(instance.name).toBe(name);
      expect(tool.mcp.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      const parsed = tool.inputSchema.parse(input);
      const result = await tool.execute(parsed, {
        requestContext: new Map([
          ['organization', '{"id":"trusted"}'],
          ['profileId', 'profile'],
        ]),
      });
      expect(result).toEqual({ output });
      expect(tool.outputSchema.safeParse(result).success).toBe(true);
      expect(service[method]).toHaveBeenCalledWith(
        ...(method === 'getPost'
          ? ['trusted', 'post', 'profile', undefined]
          : ['trusted', input, 'profile'])
      );
      expect(service.refresh).not.toHaveBeenCalled();
      expect(
        tool.inputSchema.safeParse({ ...input, organizationId: 'other' })
          .success
      ).toBe(false);
    }
  );
  it('does not leak internal/provider errors', async () => {
    const service = createMock<PostMetricsService>();
    service.summary.mockRejectedValue(new Error('token=secret'));
    const result = await (
      new AnalyticsSummaryTool(service).run() as any
    ).execute(
      {},
      { requestContext: new Map([['organization', '{"id":"trusted"}']]) }
    );
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.error.code).toBe('ANALYTICS_UNAVAILABLE');
  });
});
