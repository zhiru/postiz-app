import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '../prisma.service';
import { GetAnalyticsPostsDto } from '../../../dtos/analytics/get.analytics.posts.dto';

const publicPostSelect = {
  id: true,
  organizationId: true,
  profileId: true,
  integrationId: true,
  content: true,
  image: true,
  settings: true,
  publishDate: true,
  releaseId: true,
  releaseURL: true,
  state: true,
  integration: {
    select: { id: true, name: true, picture: true, providerIdentifier: true },
  },
} as const;

@Injectable()
export class PostMetricsRepository {
  constructor(
    private snapshots: PrismaRepository<'postMetricSnapshot'>,
    private posts: PrismaRepository<'post'>,
    private integrations: PrismaRepository<'integration'>
  ) {}
  private scope(
    organizationId: string,
    profileId?: string
  ): Prisma.PostWhereInput {
    return {
      organizationId,
      ...(profileId ? { profileId } : {}),
      deletedAt: null,
      parentPostId: null,
      state: 'PUBLISHED',
      releaseId: { not: null },
      NOT: { releaseId: 'missing' },
      OR: [
        { intervalInDays: null },
        { platformHistoryCovered: false, recurringSnapshots: { none: {} } },
      ],
      integration: {
        organizationId,
        deletedAt: null,
        ...(profileId ? { profileId } : {}),
      },
    };
  }
  list(
    organizationId: string,
    query: Omit<GetAnalyticsPostsDto, 'from' | 'to'> & { from: Date; to: Date },
    profileId?: string
  ) {
    return this.posts.model.post.findMany({
      where: {
        ...this.scope(organizationId, profileId),
        publishDate: { gte: query.from, lte: query.to },
        ...(query.integrationId ? { integrationId: query.integrationId } : {}),
        ...(query.platform
          ? {
              integration: {
                organizationId,
                deletedAt: null,
                ...(profileId ? { profileId } : {}),
                providerIdentifier: query.platform,
              },
            }
          : {}),
      },
      select: {
        ...publicPostSelect,
        metricSnapshots: {
          where: {
            organizationId,
            ...(profileId ? { profileId } : {}),
            status: 'available',
          },
          orderBy: { capturedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ publishDate: 'desc' }, { id: 'asc' }],
      take: 5001,
    });
  }
  async get(organizationId: string, id: string, profileId?: string) {
    return this.posts.model.post.findFirst({
      where: { ...this.scope(organizationId, profileId), id },
      select: {
        ...publicPostSelect,
        metricSnapshots: {
          where: {
            organizationId,
            ...(profileId ? { profileId } : {}),
            status: 'available',
          },
          orderBy: { capturedAt: 'desc' },
          take: 1,
        },
      },
    });
  }
  forCollection(organizationId: string, id: string, profileId?: string) {
    return this.posts.model.post.findFirst({
      where: { ...this.scope(organizationId, profileId), id },
      select: {
        ...publicPostSelect,
        integration: {
          select: {
            id: true,
            organizationId: true,
            profileId: true,
            internalId: true,
            name: true,
            token: true,
            tokenExpiration: true,
            providerIdentifier: true,
            additionalSettings: true,
            disabled: true,
            refreshNeeded: true,
            inBetweenSteps: true,
          },
        },
      },
    });
  }
  latestAttempt(
    organizationId: string,
    integrationId: string,
    remoteId: string,
    profileId?: string
  ) {
    return this.snapshots.model.postMetricSnapshot.findFirst({
      where: {
        organizationId,
        integrationId,
        remoteId,
        ...(profileId ? { profileId } : {}),
      },
      orderBy: { capturedAt: 'desc' },
    });
  }
  latestAttempts(organizationId: string, ids: string[], profileId?: string) {
    return this.snapshots.model.postMetricSnapshot.findMany({
      where: {
        organizationId,
        postId: { in: ids },
        ...(profileId ? { profileId } : {}),
      },
      orderBy: [{ postId: 'asc' }, { capturedAt: 'desc' }],
      distinct: ['postId'],
    });
  }
  async history(
    organizationId: string,
    integrationId: string,
    remoteId: string,
    profileId?: string,
    cursor?: string
  ) {
    if (
      cursor &&
      !(await this.snapshots.model.postMetricSnapshot.findFirst({
        where: {
          id: cursor,
          organizationId,
          integrationId,
          remoteId,
          ...(profileId ? { profileId } : {}),
        },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Invalid history cursor');
    return this.snapshots.model.postMetricSnapshot.findMany({
      where: {
        organizationId,
        integrationId,
        remoteId,
        ...(profileId ? { profileId } : {}),
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
  async record(row: {
    organizationId: string;
    profileId?: string | null;
    integrationId: string;
    postId?: string | null;
    remoteId: string;
    source: string;
    status: string;
    metrics: Prisma.InputJsonValue;
    period?: string;
    retryAt?: Date | null;
    failures?: number;
  }) {
    if (row.postId)
      await this.snapshots.model.postMetricSnapshot.updateMany({
        where: {
          organizationId: row.organizationId,
          profileId: row.profileId || null,
          integrationId: row.integrationId,
          remoteId: row.remoteId,
          postId: null,
        },
        data: { postId: row.postId },
      });
    const capturedAt = new Date();
    if (row.status === 'available') {
      const prior = await this.snapshots.model.postMetricSnapshot.findFirst({
        where: {
          organizationId: row.organizationId,
          profileId: row.profileId || null,
          integrationId: row.integrationId,
          remoteId: row.remoteId,
          status: 'available',
        },
        orderBy: { capturedAt: 'desc' },
      });
      const previous = (prior?.metrics || {}) as Record<string, any>;
      const incoming = row.metrics as Record<string, any>;
      const observedAt = { ...previous.__observedAt },
        sources = { ...previous.__sources };
      const merged = { ...previous };
      for (const [key, value] of Object.entries(incoming)) {
        if (typeof value === 'number') {
          merged[key] = value;
          observedAt[key] = capturedAt.toISOString();
          sources[key] = row.source;
        }
      }
      row.metrics = { ...merged, __observedAt: observedAt, __sources: sources };
    }

    const capturedHour = new Date(capturedAt);
    capturedHour.setUTCMinutes(0, 0, 0);
    const scopeKey = JSON.stringify([
      row.organizationId,
      row.profileId || null,
    ]);
    return this.snapshots.model.postMetricSnapshot.upsert({
      where: {
        scopeKey_integrationId_remoteId_capturedHour_source_status: {
          scopeKey,
          integrationId: row.integrationId,
          remoteId: row.remoteId,
          capturedHour,
          source: row.source,
          status: row.status,
        },
      },
      create: { ...row, scopeKey, capturedAt, capturedHour },
      update: { ...row, capturedAt },
    });
  }
  recentToCollect(providers: string[], after?: string) {
    return this.posts.model.post.findMany({
      where: {
        ...this.scopeAll(providers),
        ...(after ? { id: { gt: after } } : {}),
        publishDate: { gte: new Date(Date.now() - 86400000) },
      },
      orderBy: { id: 'asc' },
      select: { id: true, organizationId: true, profileId: true },
      take: 40,
    });
  }
  historyToCollect(providers: string[], after?: string) {
    return this.posts.model.post.findMany({
      where: {
        ...this.scopeAll(providers),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true, organizationId: true, profileId: true },
      take: 20,
    });
  }
  private scopeAll(providers: string[]): Prisma.PostWhereInput {
    return {
      state: 'PUBLISHED',
      deletedAt: null,
      parentPostId: null,
      releaseId: { not: null },
      NOT: { releaseId: 'missing' },
      OR: [
        { intervalInDays: null },
        { platformHistoryCovered: false, recurringSnapshots: { none: {} } },
      ],
      integration: {
        providerIdentifier: { in: providers },
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
    };
  }
  storyChannels(accountId: string, orgIds?: string[]) {
    return this.integrations.model.integration.findMany({
      where: {
        internalId: accountId,
        providerIdentifier: { in: ['instagram', 'instagram-standalone'] },
        deletedAt: null,
        ...(orgIds ? { organizationId: { in: orgIds } } : {}),
      },
      select: { id: true, organizationId: true, profileId: true },
    });
  }
  storyPost(integrationId: string, remoteId: string) {
    return this.posts.model.post.findFirst({
      where: {
        integrationId,
        releaseId: remoteId,
        deletedAt: null,
        state: 'PUBLISHED',
      },
      select: { id: true },
    });
  }
}
