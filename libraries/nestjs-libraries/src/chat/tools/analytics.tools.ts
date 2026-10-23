import { Injectable, HttpException } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '../agent.tool.interface';
import { checkAuth } from '../auth.context';
import { readRequestContext } from './tool.context.helper';
import { PostMetricsService } from '../../database/prisma/analytics/post-metrics.service';
const query = z
  .object({
    date: z.number().int().min(1).max(366).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    integrationId: z.string().max(200).optional(),
    platform: z.string().max(200).optional(),
    q: z.string().max(200).optional(),
    format: z.enum(['all', 'post', 'story', 'video', 'carousel']).optional(),
    page: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sort: z
      .enum([
        'reactions',
        'comments',
        'views',
        'impressions',
        'reach',
        'engagement',
        'published',
      ])
      .optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();
const counts = z.record(z.number().int().nonnegative().nullable());
const times = z.record(z.string());
const row = z.object({
  id: z.string(),
  content: z.string(),
  publishDate: z.string(),
  remoteId: z.string().nullable(),
  releaseURL: z.string().nullable(),
  reviewURL: z.string(),
  format: z.string(),
  thumbnail: z.string().nullable(),
  integrationId: z.string(),
  channelName: z.string(),
  channelPicture: z.string().nullable(),
  platform: z.string(),
  metrics: counts,
  metricCollectedAt: times,
  metricSources: times,
  engagementRate: z.object({
    value: z.number().nullable(),
    denominator: z.string().nullable(),
    denominatorValue: z.number().nullable(),
    formula: z.string().nullable(),
  }),
  updatedAt: z.string().nullable(),
  source: z.string().nullable(),
  metricPeriod: z.string(),
  status: z.string(),
  lastAttemptAt: z.string().nullable(),
  nextRefreshAt: z.string().nullable(),
  manualRefreshAfter: z.string().nullable(),
});
const summary = z.object({
  period: z.object({
    from: z.string(),
    to: z.string(),
    field: z.literal('publishDate'),
  }),
  notes: z.record(z.unknown()),
  unit: z.literal('count'),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  summary: z.object({
    posts: z.number().int(),
    availablePosts: z.number().int(),
    metrics: counts,
    coverage: z.record(
      z.object({ known: z.number().int(), total: z.number().int() })
    ),
  }),
  channels: z.array(
    z.object({ id: z.string(), name: z.string(), posts: z.number().int() })
  ),
  weekdays: z.array(z.number().int()),
});
const posts = summary.extend({
  posts: z.array(row),
  topReactions: z.array(row),
  topComments: z.array(row),
});
const single = z.object({
  post: row,
  notes: z.record(z.unknown()),
  history: z.array(
    z.object({
      capturedAt: z.string(),
      source: z.string(),
      status: z.string(),
      period: z.string(),
      metrics: counts,
      metricCollectedAt: times,
      metricSources: times,
    })
  ),
  historyNextCursor: z.string().nullable(),
});
const make = (
  name: string,
  inputSchema: any,
  execute: (
    org: string,
    profile: string | undefined,
    input: any
  ) => Promise<any>
) =>
  createTool({
    id: name,
    description:
      'Read stored published-post insights only; never refreshes, publishes or changes a post. Organization/profile come from authentication. date/from/to filter publication dates in UTC, totals are latest observed counts, NOT interactions gained in that period. Missing metrics are null, not zero. Check coverage, source, metricCollectedAt, metricPeriod and status; expired Story insights cannot be recovered. Engagement numerator=reactions+comments, denominator reach or impressions or views, explicitly returned. Narrow reports above 5000 posts. History is observed snapshots, not a daily interaction delta.',
    mcp: {
      annotations: {
        title: name,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    inputSchema,
    outputSchema: z.object({
      output: (name === 'analyticsPostTool'
        ? single
        : name === 'analyticsPostsTool'
        ? posts
        : summary
      ).optional(),
      error: z.unknown().optional(),
    }),
    execute: async (input, context) => {
      checkAuth(input, context);
      const request = readRequestContext(context);
      const org = JSON.parse(request.get('organization') as string);
      if (!org?.id) throw new Error('Organization context is required');
      try {
        return {
          output: await execute(
            org.id,
            request.get('profileId') as string | undefined,
            input
          ),
        };
      } catch (error) {
        return {
          error:
            error instanceof HttpException
              ? error.getResponse()
              : {
                  code: 'ANALYTICS_UNAVAILABLE',
                  message: 'Stored insights are temporarily unavailable.',
                },
        };
      }
    },
  });
@Injectable()
export class AnalyticsSummaryTool implements AgentToolInterface {
  constructor(private service: PostMetricsService) {}
  name = 'analyticsSummaryTool';
  run() {
    return make(this.name, query, (o, p, i) => this.service.summary(o, i, p));
  }
}
@Injectable()
export class AnalyticsPostsTool implements AgentToolInterface {
  constructor(private service: PostMetricsService) {}
  name = 'analyticsPostsTool';
  run() {
    return make(this.name, query, (o, p, i) => this.service.listPosts(o, i, p));
  }
}
@Injectable()
export class AnalyticsPostTool implements AgentToolInterface {
  constructor(private service: PostMetricsService) {}
  name = 'analyticsPostTool';
  run() {
    return make(
      this.name,
      z
        .object({
          id: z.string().min(1).max(200),
          cursor: z.string().min(1).max(200).optional(),
        })
        .strict(),
      (o, p, i) => this.service.getPost(o, i.id, p, i.cursor)
    );
  }
}
