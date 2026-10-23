import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

// Visibilidade do sininho por perfil: admin ve tudo; demais veem apenas
// notificacoes org-wide (profileId null) ou dos perfis a que pertencem.
export type NotificationScope = { isAdmin: boolean; profileIds: string[] };

function buildProfileScope(scope?: NotificationScope) {
  if (!scope || scope.isAdmin) {
    return {};
  }
  return {
    OR: [
      { profileId: null },
      ...(scope.profileIds.length
        ? [{ profileId: { in: scope.profileIds } }]
        : []),
    ],
  };
}

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _user: PrismaRepository<'user'>
  ) {}

  getLastReadNotification(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        lastReadNotifications: true,
      },
    });
  }

  async getMainPageCount(
    organizationId: string,
    userId: string,
    scope?: NotificationScope
  ) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    return {
      total: await this._notifications.model.notifications.count({
        where: {
          organizationId,
          createdAt: {
            gt: lastReadNotifications!,
          },
          ...buildProfileScope(scope),
        },
      }),
    };
  }

  async createNotification(
    organizationId: string,
    content: string,
    opts?: {
      dedupeKey?: string;
      contentKey?: string;
      contentParams?: Record<string, string | number | undefined>;
      profileId?: string | null;
    }
  ) {
    try {
      await this._notifications.model.notifications.create({
        data: {
          organizationId,
          ...(opts?.dedupeKey
            ? {
                dedupeKey: createHash('sha256')
                  .update(
                    JSON.stringify([
                      organizationId,
                      opts.profileId || null,
                      opts.dedupeKey,
                    ])
                  )
                  .digest('hex'),
              }
            : {}),
          content,
          contentKey: opts?.contentKey ?? null,
          profileId: opts?.profileId ?? null,
          ...(opts?.contentParams ? { contentParams: opts.contentParams } : {}),
        },
      });
      return true;
    } catch (error) {
      if (
        opts?.dedupeKey &&
        error instanceof Object &&
        'code' in error &&
        error.code === 'P2002'
      )
        return false;
      throw error;
    }
  }

  async getNotificationsSince(organizationId: string, since: string) {
    return this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(since),
        },
      },
    });
  }

  async getNotificationsPaginated(
    organizationId: string,
    page: number,
    scope?: NotificationScope
  ) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
      ...buildProfileScope(scope),
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          contentKey: true,
          contentParams: true,
          link: true,
          createdAt: true,
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(
    organizationId: string,
    userId: string,
    scope?: NotificationScope
  ) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        lastReadNotifications: new Date(),
      },
    });

    return {
      lastReadNotifications,
      notifications: await this._notifications.model.notifications.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        where: {
          organizationId,
          ...buildProfileScope(scope),
        },
        select: {
          createdAt: true,
          content: true,
          contentKey: true,
          contentParams: true,
        },
      }),
    };
  }
}
