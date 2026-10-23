import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { PostMetricsService } from '@gitroom/nestjs-libraries/database/prisma/analytics/post-metrics.service';
import { GetAnalyticsPostsDto } from '@gitroom/nestjs-libraries/dtos/analytics/get.analytics.posts.dto';
const countMetrics: any = {
  type: 'object',
  additionalProperties: { type: 'integer', minimum: 0, nullable: true },
  description:
    'Missing values are null, not zero. Keys: views, impressions, reach, reactions, comments, shares, saves, replies, navigation, tapForward, tapBack, exits, swipeForward.',
};
const postSchema: any = {
  type: 'object',
  required: ['id', 'metrics', 'metricCollectedAt', 'status'],
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    publishDate: { type: 'string', format: 'date-time' },
    remoteId: { type: 'string', nullable: true },
    releaseURL: { type: 'string', nullable: true },
    reviewURL: { type: 'string' },
    format: { type: 'string' },
    thumbnail: { type: 'string', nullable: true },
    integrationId: { type: 'string' },
    channelName: { type: 'string' },
    channelPicture: { type: 'string', nullable: true },
    platform: { type: 'string' },
    metrics: countMetrics,
    metricCollectedAt: {
      type: 'object',
      additionalProperties: { type: 'string', format: 'date-time' },
    },
    metricSources: { type: 'object', additionalProperties: { type: 'string' } },
    engagementRate: {
      type: 'object',
      properties: {
        value: { type: 'number', nullable: true },
        denominator: { type: 'string', nullable: true },
        denominatorValue: { type: 'number', nullable: true },
        formula: { type: 'string', nullable: true },
      },
    },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    source: { type: 'string', nullable: true },
    metricPeriod: { type: 'string' },
    status: { type: 'string' },
    manualRefreshAfter: { type: 'string', format: 'date-time', nullable: true },
  },
};
const resultSchema: any = {
  type: 'object',
  properties: {
    unit: { type: 'string', enum: ['count'] },
    period: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        field: { type: 'string', enum: ['publishDate'] },
      },
    },
    notes: { type: 'object' },
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    summary: {
      type: 'object',
      properties: {
        posts: { type: 'integer' },
        availablePosts: { type: 'integer' },
        metrics: countMetrics,
        coverage: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              known: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
    posts: { type: 'array', items: postSchema },
    topReactions: { type: 'array', items: postSchema },
    topComments: { type: 'array', items: postSchema },
    channels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          posts: { type: 'integer' },
        },
      },
    },
    weekdays: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Monday–Sunday publication counts in UTC.',
    },
  },
};
@ApiTags('Post insights')
@ApiSecurity('api-key')
@ApiResponse({
  status: 400,
  description:
    'Invalid period, cursor or report above 5000 posts: narrow the period/channel.',
})
@ApiResponse({
  status: 404,
  description:
    'Published post absent from the authenticated organization/profile.',
})
@Controller('/public/v1/analytics')
export class PublicAnalyticsController {
  constructor(private service: PostMetricsService) {}
  @Get('/summary')
  @ApiOperation({
    summary:
      'Read consolidated stored post snapshots. Never calls a network provider.',
    description:
      'Filters use publication dates in UTC. Totals are latest observed provider totals, not interactions gained during the window. Unknown values are null; coverage and sources are explicit. Engagement=(reactions+comments)/reach, falling back to impressions, then views. Counts cannot be added across overlapping audience networks.',
  })
  @ApiOkResponse({
    schema: resultSchema,
    description:
      'period, notes, unit=count, total, summary.metrics/coverage, channels, weekdays. No refresh or publication.',
  })
  summary(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Query() query: GetAnalyticsPostsDto
  ) {
    return this.service.summary(org.id, query, profile);
  }
  @Get('/posts')
  @ApiOperation({
    summary:
      'Page/search/rank stored published-post metrics, including Stories.',
  })
  @ApiOkResponse({
    schema: resultSchema,
    description:
      'summary plus posts, topReactions, topComments; per post: metrics (nullable counts), metricCollectedAt, source, metricPeriod, status, updatedAt, reviewURL, channel and format. Page is zero-based, limit 1–100.',
  })
  posts(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Query() query: GetAnalyticsPostsDto
  ) {
    return this.service.listPosts(org.id, query, profile);
  }
  @Get('/posts/:id')
  @ApiOperation({
    summary:
      'Read one published post and up to 100 durable observations, newest page in chronological order.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        post: postSchema,
        notes: { type: 'object' },
        history: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              capturedAt: { type: 'string', format: 'date-time' },
              source: { type: 'string' },
              status: { type: 'string' },
              period: { type: 'string' },
              metrics: countMetrics,
              metricCollectedAt: { type: 'object' },
              metricSources: { type: 'object' },
            },
          },
        },
        historyNextCursor: { type: 'string', nullable: true },
      },
    },
    description:
      'post, notes, history, historyNextCursor. Pass the last cursor to continue backwards; cursor must belong to the same scoped post. Expired Story metrics cannot be recovered retroactively.',
  })
  post(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() profile: string | undefined,
    @Param('id') id: string,
    @Query('cursor') cursor?: string
  ) {
    return this.service.getPost(org.id, id, profile, cursor);
  }
}
