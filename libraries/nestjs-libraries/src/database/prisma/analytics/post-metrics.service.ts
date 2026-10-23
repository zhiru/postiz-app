import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PostMetricsRepository } from './post-metrics.repository';
import {
  IntegrationManager,
  socialIntegrationList,
} from '../../../integrations/integration.manager';
import { EncryptionService } from '../../../crypto/encryption.service';
import { decryptIntegrationToken } from '../../../crypto/integration-token.helper';
import { NotificationService } from '../notifications/notification.service';
import { GetAnalyticsPostsDto } from '../../../dtos/analytics/get.analytics.posts.dto';
import { ioRedis } from '../../../redis/redis.service';
import {
  firstCalendarMedia,
  getPostFormat,
} from '@gitroom/helpers/utils/posts.list.minify';
import { postContentPlainText } from '@gitroom/helpers/utils/sanitize.post.content';
import { RefreshToken } from '../../../integrations/social.abstract';

export const METRIC_KEYS = [
  'views',
  'impressions',
  'reach',
  'reactions',
  'comments',
  'shares',
  'saves',
  'replies',
  'navigation',
  'tapForward',
  'tapBack',
  'exits',
  'swipeForward',
] as const;
export type PostMetrics = Record<(typeof METRIC_KEYS)[number], number | null>;
// Count handling and unknown-last sorting adapted from PostQueen f8e33f5 (AGPL-3.0).
const asCount = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
export function normalizePostMetrics(
  data: Array<{ label: string; data: Array<{ total: string; date: string }> }>
): PostMetrics {
  const out = Object.fromEntries(
    METRIC_KEYS.map((k) => [k, null])
  ) as PostMetrics;
  const aliases: Record<string, (typeof METRIC_KEYS)[number]> = {
    views: 'views',
    plays: 'views',
    impressions: 'impressions',
    reach: 'reach',
    likes: 'reactions',
    reactions: 'reactions',
    comments: 'comments',
    shares: 'shares',
    retweets: 'shares',
    reposts: 'shares',
    saves: 'saves',
    saved: 'saves',
    replies: 'replies',
    navigation: 'navigation',
    tap_forward: 'tapForward',
    tap_back: 'tapBack',
    tap_exit: 'exits',
    swipe_forward: 'swipeForward',
  };
  for (const row of data || []) {
    const key = aliases[row.label?.toLowerCase()];
    if (key) out[key] = asCount(row.data?.[row.data.length - 1]?.total);
  }
  return out;
}
export function engagementRate(metrics: PostMetrics) {
  const denominator =
    metrics.reach != null
      ? 'reach'
      : metrics.impressions != null
      ? 'impressions'
      : metrics.views != null
      ? 'views'
      : null;
  const base = denominator ? metrics[denominator] : null;
  return {
    value:
      base && metrics.reactions != null && metrics.comments != null
        ? ((metrics.reactions + metrics.comments) / base) * 100
        : null,
    denominator,
    denominatorValue: base,
    formula: denominator
      ? `(reactions + comments) / ${denominator} * 100`
      : null,
  };
}
const NOTES = {
  dateFilters: 'publication_date',
  numbers: 'latest_provider_snapshot',
  unit: 'count',
  nullMeansUnknownNotZero: true,
  historyIsObservedSnapshotsNotInPeriodInteractions: true,
  metricsMayHaveDifferentCollectionTimes: true,
  instagramStoryWindowHours: 24,
  unsupportedProvidersRemainUnknown: true,
};
const sumKnown = (rows: any[], key: string) => {
  const values = rows.map((r) => r.metrics[key]).filter((v) => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
function ranked(rows: any[], sort = 'reactions', dir = 'desc') {
  const value = (r: any) =>
    sort === 'published'
      ? Date.parse(r.publishDate)
      : sort === 'engagement'
      ? r.engagementRate.value
      : r.metrics[sort];
  return [...rows].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av == null || bv == null)
      return av == null ? (bv == null ? a.id.localeCompare(b.id) : 1) : -1;
    return (av - bv) * (dir === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
}
@Injectable()
export class PostMetricsService {
  constructor(
    private repository: PostMetricsRepository,
    private providers: IntegrationManager,
    private encryption: EncryptionService,
    private notifications: NotificationService
  ) {}
  private range(q: GetAnalyticsPostsDto) {
    const now = new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - (q.date || 30) + 1
          )
        );
    const to = q.to
      ? new Date(q.to)
      : new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            23,
            59,
            59,
            999
          )
        );
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+to) ||
      from > to ||
      +to - +from > 366 * 86400000
    )
      throw new BadRequestException(
        'Use a valid analytics period of up to 366 days.'
      );
    return { from, to };
  }
  private row(post: any, attempt?: any) {
    const snap = post.metricSnapshots?.[0];
    const metrics = normalizePostMetrics([]);
    const metricCollectedAt: Record<string, string> = {};
    for (const item of post.metricSnapshots || []) {
      for (const key of METRIC_KEYS) {
        if (metrics[key] == null && item.metrics?.[key] != null) {
          metrics[key] = item.metrics[key];
          metricCollectedAt[key] =
            item.metrics.__observedAt?.[key] || item.capturedAt.toISOString();
        }
      }
    }
    return {
      id: post.id,
      content: postContentPlainText(post.content),
      publishDate: post.publishDate.toISOString(),
      remoteId: post.releaseId,
      releaseURL: post.releaseURL || null,
      reviewURL: `/p/${post.id}`,
      format: getPostFormat(post),
      thumbnail: firstCalendarMedia(post.image)?.src || null,
      thumbnailVideo: !!firstCalendarMedia(post.image)?.video,
      integrationId: post.integrationId,
      channelName: post.integration.name,
      channelPicture: post.integration.picture,
      platform: post.integration.providerIdentifier,
      metrics,
      metricCollectedAt,
      metricSources: snap?.metrics?.__sources || {},
      engagementRate: engagementRate(metrics),
      updatedAt: snap?.capturedAt?.toISOString() || null,
      source: snap?.source || null,
      metricPeriod: snap?.period || 'unknown',
      status: attempt?.status || (snap ? 'available' : 'not_collected'),
      lastAttemptAt: attempt?.capturedAt?.toISOString() || null,
      nextRefreshAt: attempt?.retryAt?.toISOString() || null,
      manualRefreshAfter:
        attempt?.status === 'available'
          ? new Date(attempt.capturedAt.getTime() + 30000).toISOString()
          : attempt?.retryAt?.toISOString() || null,
    };
  }
  async listPosts(org: string, q: GetAnalyticsPostsDto, profile?: string) {
    const range = this.range(q);
    const posts = await this.repository.list(org, { ...q, ...range }, profile);
    if (posts.length > 5000)
      throw new BadRequestException(
        'Narrow the period or channel: this report exceeds 5000 posts. No partial totals were returned.'
      );
    const attempts = posts.length
      ? await this.repository.latestAttempts(
          org,
          posts.map((p) => p.id),
          profile
        )
      : [];
    const latest = new Map((attempts || []).map((a) => [a.postId, a]));
    const needle = q.q?.trim().toLocaleLowerCase();
    const rows = posts
      .map((p) => this.row(p, latest.get(p.id)))
      .filter(
        (r) =>
          (!q.format || q.format === 'all' || r.format === q.format) &&
          (!needle ||
            [r.id, r.content, r.channelName, r.platform].some((s) =>
              s.toLocaleLowerCase().includes(needle)
            ))
      );
    const sorted = ranked(rows, q.sort, q.dir),
      page = q.page || 0,
      limit = q.limit || 20;
    const coverage = Object.fromEntries(
      METRIC_KEYS.map((key) => [
        key,
        {
          known: rows.filter((r) => r.metrics[key] != null).length,
          total: rows.length,
        },
      ])
    );
    return {
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        field: 'publishDate',
      },
      notes: NOTES,
      unit: 'count',
      total: rows.length,
      page,
      limit,
      posts: sorted.slice(page * limit, (page + 1) * limit),
      topReactions: ranked(
        rows.filter((r) => r.metrics.reactions != null),
        'reactions'
      ).slice(0, 4),
      topComments: ranked(
        rows.filter((r) => r.metrics.comments != null),
        'comments'
      ).slice(0, 4),
      summary: {
        posts: rows.length,
        availablePosts: rows.filter((r) => r.updatedAt).length,
        metrics: Object.fromEntries(
          METRIC_KEYS.map((k) => [k, sumKnown(rows, k)])
        ),
        coverage,
      },
      channels: [...new Set(rows.map((r) => r.integrationId))].map((id) => ({
        id,
        name: rows.find((r) => r.integrationId === id)!.channelName,
        posts: rows.filter((r) => r.integrationId === id).length,
      })),
      weekdays: Array.from(
        { length: 7 },
        (_, day) =>
          rows.filter(
            (r) => new Date(r.publishDate).getUTCDay() === (day + 1) % 7
          ).length
      ),
    };
  }
  async summary(org: string, q: GetAnalyticsPostsDto, profile?: string) {
    const { posts, topReactions, topComments, ...result } =
      await this.listPosts(org, q, profile);
    return result;
  }
  async readMetrics(org: string, id: string, profile?: string) {
    const post = await this.repository.get(org, id, profile);
    if (!post) throw new NotFoundException('Published post not found');
    const attempt = await this.repository.latestAttempt(
      org,
      post.integrationId,
      post.releaseId!,
      post.profileId || undefined
    );
    const row = this.row(post, attempt);
    return {
      metrics: METRIC_KEYS.filter((key) => row.metrics[key] != null).map(
        (key) => ({
          label: key,
          percentageChange: 0,
          data: [
            {
              total: String(row.metrics[key]),
              date: (row.metricCollectedAt[key] || row.updatedAt || '').slice(
                0,
                10
              ),
            },
          ],
        })
      ),
      metricsCheckedAt: row.updatedAt,
      metricsAvailable: row.status === 'available',
    };
  }
  async getPost(org: string, id: string, profile?: string, cursor?: string) {
    const post = await this.repository.get(org, id, profile);
    if (!post) throw new NotFoundException('Published post not found');
    const [attempt, history] = await Promise.all([
      this.repository.latestAttempt(
        org,
        post.integrationId,
        post.releaseId!,
        post.profileId || undefined
      ),
      this.repository.history(
        org,
        post.integrationId,
        post.releaseId!,
        post.profileId || undefined,
        cursor
      ),
    ]);
    return {
      post: this.row(post, attempt),
      notes: NOTES,
      history: (history || [])
        .slice(0, 100)
        .reverse()
        .map((s) => ({
          capturedAt: s.capturedAt.toISOString(),
          source: s.source,
          status: s.status,
          period: s.period,
          metrics: Object.fromEntries(
            METRIC_KEYS.map((key) => [key, (s.metrics as any)?.[key] ?? null])
          ),
          metricCollectedAt: (s.metrics as any)?.__observedAt || {},
          metricSources: (s.metrics as any)?.__sources || {},
        })),
      historyNextCursor: history?.length > 100 ? history[99].id : null,
    };
  }
  async csv(org: string, q: GetAnalyticsPostsDto, profile?: string) {
    const all = await this.listPosts(
      org,
      { ...q, page: 0, limit: Number.MAX_SAFE_INTEGER },
      profile
    );
    const cell = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^\s*[=+@-]|^[\t\r\n]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return [
      [
        'id',
        'channel',
        'platform',
        'format',
        'publishedAt',
        ...METRIC_KEYS,
        'engagementPercent',
        'engagementDenominator',
        'engagementFormula',
        'updatedAt',
        'source',
        'status',
      ],
      ...all.posts.map((p) => [
        p.id,
        p.channelName,
        p.platform,
        p.format,
        p.publishDate,
        ...METRIC_KEYS.map((k) => p.metrics[k]),
        p.engagementRate.value,
        p.engagementRate.denominator,
        p.engagementRate.formula,
        p.updatedAt,
        p.source,
        p.status,
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n');
  }
  async refresh(org: string, id: string, profile?: string, manual = false) {
    const post = await this.repository.forCollection(org, id, profile);
    if (!post) throw new NotFoundException('Published post not found');
    const cacheKey = `post-metrics:${org}:${post.profileId || 'org'}:${
      post.integrationId
    }:${post.releaseId}`;
    const lease = randomUUID();
    if (
      (await ioRedis.set(cacheKey + ':lock', lease, 'EX', 120, 'NX')) !== 'OK'
    )
      return { status: 'in_progress' };
    try {
      const previous = await this.repository.latestAttempt(
        org,
        post.integrationId,
        post.releaseId!,
        post.profileId || undefined
      );
      const now = Date.now();
      const story = getPostFormat(post) === 'story';
      const age = now - (previous?.capturedAt?.getTime() || 0);
      const cooldown =
        previous?.status === 'available'
          ? manual
            ? 30000
            : story
            ? 30 * 60000
            : 6 * 3600000
          : Math.max(
              30000,
              (previous?.retryAt?.getTime() || 0) -
                (previous?.capturedAt?.getTime() || 0)
            );
      if (previous && age < cooldown)
        return {
          status: 'cooldown',
          nextRefreshAt: new Date(
            previous.capturedAt.getTime() + cooldown
          ).toISOString(),
        };
      const common = {
        organizationId: org,
        profileId: post.profileId,
        integrationId: post.integrationId,
        postId: post.id,
        remoteId: post.releaseId!,
        source: 'provider',
      };
      const fail = async (status: string) => {
        const failures = (previous?.failures || 0) + 1;
        const retryAt = new Date(
          now + Math.min(6 * 3600000, 900000 * 2 ** Math.min(failures - 1, 5))
        );
        await this.repository.record({
          ...common,
          status,
          metrics: normalizePostMetrics([]),
          retryAt,
          failures,
        });
        if (!['unsupported', 'window_expired'].includes(status))
          try {
            await this.notifications.inAppNotification(
              org,
              {
                subjectKey: 'notif_post_metrics_unavailable',
                messageKey: 'notif_post_metrics_unavailable',
                profileId: post.profileId,
                dedupeKey: `metrics:${post.integrationId}:${status}:${new Date()
                  .toISOString()
                  .slice(0, 10)}`,
                params: { name: post.integration.name },
              },
              false
            );
          } catch {
            /* Notification failure must not change publication state. */
          }
        return { status, nextRefreshAt: retryAt.toISOString() };
      };
      const provider = this.providers.getSocialIntegration(
        post.integration.providerIdentifier
      );
      if (
        story &&
        provider?.storyInsightsWindowHours &&
        now - post.publishDate.getTime() >
          provider.storyInsightsWindowHours * 3600000
      )
        return fail('window_expired');
      const readMetrics = story
        ? provider?.storyAnalytics
        : provider?.postAnalytics;
      if (!readMetrics) return fail('unsupported');
      if (post.integration.refreshNeeded || post.integration.disabled)
        return fail('permission_required');
      let data: any[];
      try {
        data = await readMetrics.call(
          provider,
          post.integration.internalId,
          decryptIntegrationToken(this.encryption, post.integration.token),
          post.releaseId!,
          7,
          post.integration as any
        );
      } catch (error) {
        return fail(
          error instanceof RefreshToken
            ? 'permission_required'
            : 'transient_error'
        );
      }
      const metrics = normalizePostMetrics(data || []);
      if (!Object.values(metrics).some((v) => v != null))
        return fail('unavailable');
      const retryAt = new Date(
        now + (manual ? 30000 : story ? 30 * 60000 : 6 * 3600000)
      );
      await this.repository.record({
        ...common,
        status: 'available',
        metrics,
        period: provider.postAnalyticsLifetime
          ? 'lifetime'
          : 'provider_window_unknown',
        retryAt,
        failures: 0,
      });
      return {
        status: 'available',
        nextRefreshAt: retryAt.toISOString(),
        data,
      };
    } finally {
      await ioRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        cacheKey + ':lock',
        lease
      );
    }
  }
  async collectBatch() {
    const names = socialIntegrationList
      .filter((p) => !!p.postAnalytics || !!p.storyAnalytics)
      .map((p) => p.identifier);
    if (!names.length) return;
    const cursorKey = 'post-metrics-history-cursor-v1',
      recentKey = 'post-metrics-recent-cursor-v1';
    const [after, recentAfter] = await Promise.all([
      ioRedis.get(cursorKey),
      ioRedis.get(recentKey),
    ]);
    const [recent, old] = await Promise.all([
      this.repository.recentToCollect(names, recentAfter || undefined),
      this.repository.historyToCollect(names, after || undefined),
    ]);
    const deadline = Date.now() + 90000,
      seen = new Set<string>();
    for (const [posts, key] of [
      [recent, recentKey],
      [old, cursorKey],
    ] as const) {
      for (const post of posts) {
        if (Date.now() > deadline) return;
        if (!seen.has(post.id)) {
          seen.add(post.id);
          try {
            await this.refresh(
              post.organizationId,
              post.id,
              post.profileId || undefined
            );
          } catch {
            /* Collection never retries publication. */
          }
        }
        await ioRedis.set(key, post.id);
      }
      if (!posts.length) await ioRedis.del(key);
    }
  }
  async storyWebhook(
    accountId: string,
    value: Record<string, unknown>,
    orgIds?: string[]
  ) {
    const remoteId = value?.media_id || value?.id;
    if (typeof remoteId !== 'string' || !remoteId) return;
    const labels: Record<string, string> = {
      impressions: 'Impressions',
      views: 'Views',
      reach: 'Reach',
      replies: 'Replies',
      shares: 'Shares',
      navigation: 'Navigation',
      taps_forward: 'tap_forward',
      taps_back: 'tap_back',
      exits: 'tap_exit',
      swipe_forward: 'swipe_forward',
    };
    const data = Object.entries(labels)
      .filter(([key]) => asCount(value[key]) != null)
      .map(([key, label]) => ({
        label,
        data: [
          {
            total: String(value[key]),
            date: new Date().toISOString().slice(0, 10),
          },
        ],
      }));
    const metrics = normalizePostMetrics(data);
    if (!Object.values(metrics).some((v) => v != null)) return;
    for (const channel of await this.repository.storyChannels(
      accountId,
      orgIds
    )) {
      const post = await this.repository.storyPost(channel.id, remoteId);
      const key = `post-metrics:${channel.organizationId}:${
          channel.profileId || 'org'
        }:${channel.id}:${remoteId}:lock`,
        lease = randomUUID();
      if ((await ioRedis.set(key, lease, 'EX', 120, 'NX')) !== 'OK')
        throw new Error('Story observation busy');
      try {
        await this.repository.record({
          organizationId: channel.organizationId,
          profileId: channel.profileId,
          integrationId: channel.id,
          postId: post?.id,
          remoteId,
          source: 'instagram_story_webhook',
          status: 'available',
          period: 'lifetime',
          metrics,
        });
      } finally {
        await ioRedis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          lease
        );
      }
    }
  }
}
