import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  ReportChannel,
  ReportDataPoint,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/report.aggregate';

@Injectable()
export class AnalyticsReportRepository {
  constructor(
    private _integrationAnalytics: PrismaRepository<'integrationAnalytics'>,
    private _integration: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>
  ) {}

  // Disabled channels are intentionally still listed: their past days are real
  // history and should not disappear from a report because the channel was
  // switched off. getCollectableIntegrations skips them, so they simply stop
  // gaining new days.
  async getChannels(
    organizationId: string,
    integrationIds?: string[]
  ): Promise<ReportChannel[]> {
    return this._integration.model.integration.findMany({
      where: {
        organizationId,
        type: 'social',
        deletedAt: null,
        ...(integrationIds?.length ? { id: { in: integrationIds } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
        picture: true,
      },
    });
  }

  async getPoints(
    organizationId: string,
    integrationIds: string[],
    from: string,
    to: string
  ): Promise<ReportDataPoint[]> {
    if (!integrationIds.length) {
      return [];
    }

    const rows = await this._integrationAnalytics.model.integrationAnalytics.findMany(
      {
        where: {
          organizationId,
          integrationId: { in: integrationIds },
          date: {
            gte: dayjs(from).startOf('day').toDate(),
            lte: dayjs(to).endOf('day').toDate(),
          },
        },
        select: { integrationId: true, date: true, metric: true, value: true },
      }
    );

    return rows.map((row) => ({
      integrationId: row.integrationId,
      date: dayjs(row.date).format('YYYY-MM-DD'),
      metric: row.metric as ReportDataPoint['metric'],
      value: row.value,
    }));
  }

  // Published posts are not a provider metric, they are ours, so they are
  // counted live instead of being collected into the analytics table.
  // ponytail: reads the rows and counts them in memory rather than grouping in
  // SQL, because Prisma cannot group by day without a raw query and raw SQL is
  // not allowed here. Move to a stored daily counter if a period ever returns
  // enough posts for this to matter.
  async getPublishedPosts(
    organizationId: string,
    integrationIds: string[],
    from: string,
    to: string
  ): Promise<ReportDataPoint[]> {
    if (!integrationIds.length) {
      return [];
    }

    const posts = await this._posts.model.post.findMany({
      where: {
        organizationId,
        integrationId: { in: integrationIds },
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
        publishDate: {
          gte: dayjs(from).startOf('day').toDate(),
          lte: dayjs(to).endOf('day').toDate(),
        },
      },
      select: { integrationId: true, publishDate: true },
    });

    const counted = posts.reduce((all, post) => {
      const key = `${post.integrationId}|${dayjs(post.publishDate).format(
        'YYYY-MM-DD'
      )}`;
      all.set(key, (all.get(key) || 0) + 1);

      return all;
    }, new Map<string, number>());

    return [...counted.entries()].map(([key, value]) => {
      const [integrationId, date] = key.split('|');

      return {
        integrationId,
        date,
        metric: 'postsPublished' as const,
        value,
      };
    });
  }

  // Every social channel the daily collection workflow should visit, with its
  // organization attached so the collector does not query one per integration.
  async getCollectableIntegrations() {
    return this._integration.model.integration.findMany({
      where: {
        type: 'social',
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
      select: {
        id: true,
        providerIdentifier: true,
        organization: true,
      },
    });
  }

  // Writes only, never deletes: re-running the collector or the backfill for a
  // day overwrites that day's value, and a day the provider no longer answers
  // for keeps whatever was collected when it did. That makes both paths
  // idempotent, at the cost of a value never being revised back down to zero.
  async savePoints(organizationId: string, points: ReportDataPoint[]) {
    for (const point of points) {
      const date = dayjs(point.date).startOf('day').toDate();
      await this._integrationAnalytics.model.integrationAnalytics.upsert({
        where: {
          integrationId_date_metric: {
            integrationId: point.integrationId,
            date,
            metric: point.metric,
          },
        },
        create: {
          organizationId,
          integrationId: point.integrationId,
          date,
          metric: point.metric,
          value: point.value,
        },
        update: { value: point.value },
      });
    }

    return points.length;
  }
}
