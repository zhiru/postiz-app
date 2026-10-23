import { getPostFormat } from '@gitroom/helpers/utils/posts.list.minify';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PublishedPlatformPost } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Injectable, ConflictException } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  CreationMethod,
  Post,
  State,
  Prisma,
  CommentKind,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';

dayjs.extend(isoWeek);

dayjs.extend(weekOfYear);

dayjs.extend(isSameOrAfter);

dayjs.extend(utc);

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _transaction: PrismaTransaction
  ) {}

  async getManagedPost(
    orgId: string,
    profileId: string | undefined,
    id: string
  ) {
    const scope: Prisma.PostWhereInput = {
      organizationId: orgId,
      ...(profileId ? { profileId } : {}),
      deletedAt: null,
    };
    const select = {
      id: true,
      organizationId: true,
      profileId: true,
      integrationId: true,
      group: true,
      parentPostId: true,
      content: true,
      image: true,
      settings: true,
      delay: true,
      state: true,
      publishDate: true,
      updatedAt: true,
      releaseId: true,
      releaseURL: true,
      importedFromPlatform: true,
      error: true,
      comments: {
        where: { deletedAt: null as Date | null, organizationId: orgId },
        select: {
          id: true,
          content: true,
          parentId: true,
          createdAt: true,
          resolvedAt: true,
        },
      },
      integration: {
        select: { id: true, name: true, providerIdentifier: true },
      },
    } as const;
    const root = await this._post.model.post.findFirst({
      where: { ...scope, id, parentPostId: null },
      select,
    });
    if (!root) return [];
    const rows = await this._post.model.post.findMany({
      where: { ...scope, group: root.group, integrationId: root.integrationId },
      select,
    });
    const ordered = [root];
    const seen = new Set([root.id]);
    while (true) {
      const next = rows.find(
        (r) =>
          r.parentPostId === ordered[ordered.length - 1].id && !seen.has(r.id)
      );
      if (!next) break;
      ordered.push(next);
      seen.add(next.id);
    }
    return ordered;
  }

  async patchManagedPost(
    orgId: string,
    profileId: string | undefined,
    id: string,
    version: string,
    data: Pick<
      Prisma.PostUncheckedUpdateManyInput,
      'content' | 'image' | 'settings' | 'state' | 'publishDate'
    >
  ) {
    const result = await this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        deletedAt: null,
        updatedAt: new Date(version),
        state: { in: ['DRAFT', 'QUEUE', 'ERROR'] },
        OR: [
          { state: { not: 'QUEUE' } },
          { publishDate: { gt: new Date(Date.now() + 30000) } },
        ],
        importedFromPlatform: false,
        releaseId: null,
      },
      data: {
        ...data,
        updatedAt: new Date(
          Math.max(Date.now(), new Date(version).getTime() + 1)
        ),
      },
    });
    if (result.count !== 1)
      throw new ConflictException({
        code: 'POST_VERSION_CONFLICT',
        message:
          'Post changed, is published, or is no longer editable. Read it again.',
      });
    return true;
  }

  async reservePostOperation(
    id: string,
    organizationId: string,
    profileId: string | undefined,
    requestHash: string
  ) {
    try {
      await this._transaction.model.$transaction((tx) =>
        tx.postOperation.create({
          data: { id, organizationId, profileId, requestHash },
        })
      );
      return { claimed: true, requestHash, result: null as string | null };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const receipt = await this._transaction.model.$transaction((tx) =>
        tx.postOperation.findUnique({ where: { id } })
      );
      return {
        claimed: false,
        requestHash: receipt.requestHash,
        result: receipt.result,
      };
    }
  }

  completePostOperation(id: string, result: unknown) {
    return this._transaction.model.$transaction((tx) =>
      tx.postOperation.update({
        where: { id },
        data: { result: JSON.stringify(result) },
        select: { id: true },
      })
    );
  }

  releasePostQueueLock(id: string, owner: string) {
    return this._transaction.model.$transaction((tx) =>
      tx.postOperation.deleteMany({
        where: { id: `queue:${id}`, requestHash: owner },
      })
    );
  }

  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
          deletedAt: null,
        },
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          lt: dayjs.utc().toDate(),
        },
        state: 'QUEUE',
        OR: [{ profileId: null }, { profile: { deletedAt: null } }],
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
            id: true,
          },
        },
        publishDate: true,
      },
    });
  }

  getOldPosts(orgId: string, date: string, profileId?: string) {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        image: images,
      },
    });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  private curatedError(error?: string | null): string | null {
    if (!error) {
      return null;
    }
    try {
      const parsed = JSON.parse(error);
      const [type, message] = parsed?.cause?.failure?.message
        ? [parsed?.cause?.type, parsed?.cause?.failure?.message]
        : [
            parsed?.failure?.cause?.applicationFailureInfo?.type,
            parsed?.failure?.cause?.message,
          ];
      return type === 'bad_body' && message && message !== 'Unknown Error'
        ? message
        : null;
    } catch (err) {
      return null;
    }
  }

  async getPosts(
    orgId: string,
    query: GetPostsDto,
    includeAttachments = false,
    profileId?: string,
    includeFormat = false
  ) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    const endDate = dayjs.utc(query.endDate).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
                ...(profileId ? { profileId } : {}),
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        error: true,
        intervalInDays: true,
        group: true,
        creationMethod: true,
        importedFromPlatform: true,
        platformHistoryCovered: true,
        settings: true,
        ...(includeAttachments || includeFormat ? { image: true } : {}),
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    const templates = list.filter((post) => post.intervalInDays);
    const snapshots = templates.length
      ? await this._post.model.post.findMany({
          where: {
            organizationId: orgId,
            ...(profileId ? { profileId } : {}),
            recurringSourceId: { in: templates.map((post) => post.id) },
            recurringSlotDate: { gte: startDate, lte: endDate },
          },
          select: { recurringSourceId: true, recurringSlotDate: true },
        })
      : [];
    const materializedSlots = new Set(
      snapshots.map(
        (post) =>
          `${post.recurringSourceId}:${post.recurringSlotDate?.getTime()}`
      )
    );
    return list
      .map(({ image, ...post }) => ({
        ...post,
        ...(includeAttachments ? { image } : {}),
        ...(includeFormat ? { format: getPostFormat({ ...post, image }) } : {}),
        error: this.curatedError(post.error),
      }))
      .reduce((all, post) => {
        const { platformHistoryCovered, ...visible } = post;
        if (!post.intervalInDays) {
          return [...all, visible];
        }

        const addMorePosts = [];
        let startingDate = dayjs.utc(post.publishDate);
        while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
          // Once actual history is available, past virtual occurrences of a
          // recurring template must not masquerade as separate publications.
          const historicalTemplate =
            platformHistoryCovered &&
            post.state === 'PUBLISHED' &&
            startingDate.isBefore(dayjs.utc());
          const materialized = materializedSlots.has(
            `${post.id}:${startingDate.valueOf()}`
          );
          if (
            !historicalTemplate &&
            !materialized &&
            dayjs(startingDate).isSameOrAfter(dayjs.utc(post.publishDate))
          ) {
            addMorePosts.push({
              ...visible,
              publishDate: startingDate.toDate(),
              actualDate: post.publishDate,
            });
          }

          startingDate = startingDate.add(post.intervalInDays, 'days');
        }

        return [...all, ...addMorePosts];
      }, [] as any[]);
  }

  async getPostsList(
    orgId: string,
    query: GetPostsListDto,
    profileId?: string
  ) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft' || stateFilter === 'overdue'
        ? { state: State.DRAFT }
        : stateFilter === 'error'
        ? { state: State.ERROR }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'scheduled' || stateFilter === 'draft' ? 'asc' : 'desc';

    const where: Prisma.PostWhereInput = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
              ...(profileId ? { profileId } : {}),
            },
          ],
        },
      ],
      ...stateAndDate,
      ...(stateFilter === 'scheduled'
        ? { publishDate: { gte: dayjs.utc().toDate() } }
        : stateFilter === 'overdue'
        ? { publishDate: { lt: dayjs.utc().toDate() } }
        : {}),
      ...(query.search?.trim()
        ? { content: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
        ...(query.integrations
          ? {
              id: { in: query.integrations },
            }
          : {}),
      },
    };

    if (query.format && query.format !== 'all') {
      // shortcut: classify scoped metadata before paging; index a normalized format if histories make this slow.
      const candidates = await this._post.model.post.findMany({
        where,
        select: { id: true, settings: true, image: true, releaseURL: true },
      });
      (where.AND as Prisma.PostWhereInput[]).push({
        id: {
          in: candidates
            .filter((post) => getPostFormat(post) === query.format)
            .map((post) => post.id),
        },
      });
    }

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ publishDate: orderDirection }, { id: orderDirection }],
        select: {
          id: true,
          settings: true,
          image: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          importedFromPlatform: true,
          tags: {
            where: {
              tag: {
                deletedAt: null,
              },
            },
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    return {
      posts: posts.map(({ settings, image, ...post }) => ({
        ...post,
        format: getPostFormat({ ...post, settings, image }),
      })),
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string, profileId?: string) {
    await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        group,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        group,
        parentPostId: null,
      },
      select: {
        id: true,
      },
    });
  }

  getPostsByGroup(orgId: string, group: string, profileId?: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        ...(profileId ? { profileId } : {}),
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
      },
    });
  }

  getPostsByBatch(
    orgId: string,
    batchId: string,
    exceptGroup: string,
    profileId?: string
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        batchId,
        group: {
          not: exceptGroup,
        },
        deletedAt: null,
        integration: {
          deletedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  getPost(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
        OR: [{ profileId: null }, { profile: { deletedAt: null } }],
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                where: {
                  tag: {
                    deletedAt: null,
                  },
                },
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
  }

  private async platformTransaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._transaction.model.$transaction(run, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (
          attempt >= 4 ||
          !['P2002', 'P2034'].includes((error as { code?: string }).code || '')
        )
          throw error;
      }
    }
  }

  private savePlatformRelease(
    id: string,
    postId: string,
    releaseURL?: string,
    options: {
      organizationId?: string;
      missingOnly?: boolean;
      published?: boolean;
    } = {}
  ) {
    return this.platformTransaction(async (tx) => {
      const native = await tx.post.findFirstOrThrow({
        where: {
          id,
          ...(options.organizationId
            ? { organizationId: options.organizationId }
            : {}),
          ...(options.missingOnly ? { releaseId: 'missing' } : {}),
        },
      });
      if (
        options.published &&
        !native.parentPostId &&
        native.intervalInDays &&
        postId &&
        postId !== 'missing'
      ) {
        const now = new Date();
        const interval = native.intervalInDays * 86400000;
        const slot = new Date(
          native.publishDate.getTime() +
            Math.max(
              0,
              Math.floor(
                (now.getTime() - native.publishDate.getTime()) / interval
              )
            ) *
              interval
        );
        const tags = await tx.tagsPosts.findMany({
          where: { postId: id },
          select: { tagId: true },
        });
        const snapshot = await tx.post.findUnique({
          where: {
            integrationId_externalId: {
              integrationId: native.integrationId,
              externalId: String(postId),
            },
          },
        });
        await tx.post.upsert({
          where: {
            integrationId_externalId: {
              integrationId: native.integrationId,
              externalId: String(postId),
            },
          },
          create: {
            organizationId: native.organizationId,
            profileId: native.profileId,
            integrationId: native.integrationId,
            externalId: String(postId),
            releaseId: String(postId),
            releaseURL,
            state: 'PUBLISHED',
            publishDate: now,
            content: native.content,
            image: native.image,
            settings: native.settings,
            group: uuidv4(),
            creationMethod: native.creationMethod,
            importedFromPlatform: true,
            recurringSourceId: id,
            recurringSlotDate: slot,
            tags: { create: tags.map(({ tagId }) => ({ tagId })) },
          },
          update: {
            profileId: native.profileId,
            recurringSourceId: id,
            recurringSlotDate: snapshot?.recurringSlotDate || slot,
            ...(releaseURL ? { releaseURL } : {}),
          },
        });
      }
      // Recurring roots are schedule templates: each real occurrence gets its
      // own imported record, including the latest one, with the actual timestamp.
      const externalId =
        !native.intervalInDays && postId && postId !== 'missing'
          ? String(postId)
          : null;
      if (externalId) {
        const imported = await tx.post.findUnique({
          where: {
            integrationId_externalId: {
              integrationId: native.integrationId,
              externalId,
            },
          },
        });
        if (imported && imported.id !== id) {
          if (!imported.importedFromPlatform)
            throw new Error('Media already belongs to another published post');
          await tx.post.update({
            where: { id: imported.id },
            data: { externalId: null, deletedAt: new Date() },
          });
        }
      }
      return tx.post.update({
        where: { id },
        data: {
          ...(options.published ? { state: 'PUBLISHED', error: null } : {}),
          ...(releaseURL ? { releaseURL } : {}),
          releaseId: postId,
          externalId,
        },
      });
    });
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this.savePlatformRelease(id, postId, releaseURL, {
      published: true,
    });
  }

  importPlatformPost(
    organizationId: string,
    integrationId: string,
    item: PublishedPlatformPost,
    profileId?: string
  ) {
    return this.platformTransaction(async (tx) => {
      const existing = await tx.post.findFirst({
        where: {
          organizationId,
          integrationId,
          intervalInDays: null,
          OR: [{ externalId: item.id }, { releaseId: item.id }],
        },
        orderBy: { importedFromPlatform: 'asc' },
      });
      // Native posts keep their content, tags, schedules and analytics identity.
      // Deleted posts remain deleted rather than reappearing on the next import.
      if (existing && (!existing.importedFromPlatform || existing.deletedAt))
        return false;
      const data = {
        content:
          '<p>' +
          item.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>') +
          '</p>',
        publishDate: new Date(item.publishedAt),
        releaseURL: item.url,
        image: JSON.stringify(item.media),
      };
      if (existing) {
        await tx.post.update({ where: { id: existing.id }, data });
        return false;
      }
      await tx.post.create({
        data: {
          ...data,
          organizationId,
          integrationId,
          externalId: item.id,
          releaseId: item.id,
          importedFromPlatform: true,
          ...(profileId ? { profileId } : {}),
          state: 'PUBLISHED',
          group: uuidv4(),
          creationMethod: 'UNKNOWN',
          settings: '{}',
        },
      });
      return true;
    });
  }

  getRecurringSyncCandidates(organizationId: string, integrationId: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        integrationId,
        intervalInDays: { not: null },
        deletedAt: null,
      },
      select: { id: true, settings: true },
    });
  }

  coverRecurringHistory(
    organizationId: string,
    integrationId: string,
    ids: string[]
  ) {
    return this._post.model.post.updateMany({
      where: { organizationId, integrationId, id: { in: ids } },
      data: { platformHistoryCovered: true },
    });
  }

  setReleaseDetails(id: string, postId: string, releaseURL: string) {
    return this.savePlatformRelease(id, postId, releaseURL);
  }

  updateReleaseId(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL?: string
  ) {
    return this.savePlatformRelease(id, releaseId, releaseURL, {
      organizationId: orgId,
      missingOnly: true,
    });
  }

  updateResolvedRelease(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL: string
  ) {
    return this.savePlatformRelease(id, releaseId, releaseURL, {
      organizationId: orgId,
    });
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    const update = await this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state,
        ...(err
          ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        await this._errors.model.errors.create({
          data: {
            message: typeof err === 'string' ? err : JSON.stringify(err),
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body: typeof body === 'string' ? body : JSON.stringify(body),
          },
        });
      } catch (err) {}
    }

    return update;
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule',
    profileId?: string,
    expectedVersion?: string
  ) {
    try {
      return await this._post.model.post.update({
        where: {
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
          id,
          ...(expectedVersion
            ? {
                updatedAt: new Date(expectedVersion),
                state: { in: ['DRAFT', 'QUEUE', 'ERROR'] as State[] },
                OR: [
                  { state: { not: 'QUEUE' as State } },
                  { publishDate: { gt: new Date(Date.now() + 30000) } },
                ],
                releaseId: null,
                importedFromPlatform: false,
              }
            : {}),
        },
        data: {
          publishDate: dayjs(date).toDate(),
          ...(expectedVersion
            ? {
                updatedAt: new Date(
                  Math.max(Date.now(), new Date(expectedVersion).getTime() + 1)
                ),
              }
            : {}),
          // schedule: set state to QUEUE (or DRAFT if it was a draft)
          // update: don't change the state
          ...(action === 'schedule'
            ? {
                state: isDraft ? 'DRAFT' : 'QUEUE',
                releaseId: null,
                releaseURL: null,
                error: null,
              }
            : {}),
        },
      });
    } catch (error) {
      if (expectedVersion && (error as { code?: string }).code === 'P2025')
        throw new ConflictException({
          code: 'POST_VERSION_CONFLICT',
          message: 'Read the latest post before changing its date.',
        });
      throw error;
    }
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        // Imported history and recurring snapshots are records of publications,
        // not additional scheduling requests that consume the monthly quota.
        importedFromPlatform: false,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number,
    // Keep the existing group instead of rotating it, so open clients
    // (calendar) holding the group stay valid. Used by out-of-band updates
    // (agent / MCP / public API); the dashboard keeps the rotate-and-sweep.
    keepGroup = false,
    // Shared by the posts saved together for several channels, so opening one
    // of them in the editor brings the others.
    batchId?: string,
    profileId?: string
  ) {
    const posts: Post[] = [];
    const uuid = uuidv4();
    const group = keepGroup && body.group ? body.group : uuid;

    // an edited post stays in the batch it was created in, even when it is
    // saved on its own or with a group that was rotated since
    const ids = body.value.map((value) => value.id).filter(Boolean);
    const existingBatchId =
      body.group || ids.length
        ? (
            await this._post.model.post.findFirst({
              where: {
                organizationId: orgId,
                ...(profileId ? { profileId } : {}),
                deletedAt: null,
                batchId: {
                  not: null,
                },
                OR: [
                  ...(body.group ? [{ group: body.group }] : []),
                  ...(ids.length ? [{ id: { in: ids } }] : []),
                ],
              },
              select: {
                batchId: true,
              },
            })
          )?.batchId
        : undefined;

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        ...(profileId ? { profile: { connect: { id: profileId } } } : {}),
        publishDate: dayjs(date).toDate(),
        integration: {
          connect: {
            id: body.integration.id,
            organizationId: orgId,
            ...(profileId ? { profileId } : {}),
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group,
        batchId: existingBatchId || batchId,
        intervalInDays: inter ? +inter : null,
        approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
        ...(type === 'create' ? { creationMethod } : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await this._post.model.post.upsert({
          where: {
            id: value.id || uuidv4(),
            organizationId: orgId,
            ...(profileId ? { profileId } : {}),
          },
          create: { ...updateData('create') },
          update: {
            ...updateData('update'),
            lastMessage: {
              disconnect: true,
            },
            submittedForOrder: {
              disconnect: true,
            },
          },
        })
      );

      if (posts.length === 1) {
        await this._tagsPosts.model.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
            },
          },
        });

        if (tags.length) {
          const tagsList = await this._tags.model.tags.findMany({
            where: {
              orgId: orgId,
              ...(profileId ? { profileId } : {}),
              deletedAt: null,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await this._post.model.post.update({
              where: {
                id: posts[posts.length - 1].id,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    const previousPost = body.group
      ? (
          await this._post.model.post.findFirst({
            where: {
              organizationId: orgId,
              ...(profileId ? { profileId } : {}),
              group: body.group,
              deletedAt: null,
              parentPostId: null,
            },
            select: {
              id: true,
            },
          })
        )?.id!
      : undefined;

    if (body.group && !keepGroup) {
      await this._post.model.post.updateMany({
        where: {
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
          group: body.group,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    // keepGroup: the updated rows still carry the old group, so sweep only the
    // rows dropped from it (removed comments) by id instead of by group.
    if (body.group && keepGroup) {
      await this._post.model.post.updateMany({
        where: {
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
          group: body.group,
          deletedAt: null,
          id: {
            notIn: posts.map((p) => p.id),
          },
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return { previousPost, posts };
  }

  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  getPostById(id: string, org?: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(org ? { organizationId: org } : {}),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });
  }

  private get postTimelineSelect() {
    return {
      id: true,
      state: true,
      publishDate: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      releaseId: true,
      releaseURL: true,
      error: true,
      creationMethod: true,
      group: true,
      parentPostId: true,
    } as const;
  }

  getPostTimeline(id: string, org: string) {
    return this._post.model.post.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: {
        ...this.postTimelineSelect,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            disabled: true,
            refreshNeeded: true,
            deletedAt: true,
          },
        },
        childrenPost: {
          select: this.postTimelineSelect,
          orderBy: { publishDate: 'asc' as const },
        },
        errors: {
          select: {
            id: true,
            platform: true,
            message: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    });
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs,
    profileId?: string
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  getCommentsForPosts(postIds: string[]) {
    return this._comments.model.comments.findMany({
      where: {
        postId: {
          in: postIds,
        },
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            name: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  getCommentById(id: string) {
    return this._comments.model.comments.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        post: {
          select: {
            id: true,
            organizationId: true,
          },
        },
      },
    });
  }

  setCommentResolved(id: string, resolvedAt: Date | null) {
    return this._comments.model.comments.update({
      where: {
        id,
      },
      data: {
        resolvedAt,
      },
    });
  }

  getAnchoredCommentsForPost(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        deletedAt: null,
        anchorStart: {
          not: null,
        },
      },
    });
  }

  detachAnchorsForPost(postId: string, ids: string[]) {
    return this._comments.model.comments.updateMany({
      where: {
        postId,
        id: {
          in: ids,
        },
      },
      data: {
        anchorStart: null,
        anchorEnd: null,
      },
    });
  }

  async getTags(orgId: string, profileId?: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        ...(profileId ? { profileId } : {}),
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto, profileId?: string) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        ...(profileId ? { profileId } : {}),
        name: body.name,
        color: body.color,
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto, profileId?: string) {
    return this._tags.model.tags.update({
      where: {
        id,
      },
      data: {
        name: body.name,
        color: body.color,
      },
    });
  }

  async deleteTag(id: string, orgId: string, profileId?: string) {
    const tag = await this._tags.model.tags.update({
      where: {
        id,
        orgId,
        ...(profileId ? { profileId } : {}),
      },
      data: {
        deletedAt: new Date(),
      },
    });

    await this._tagsPosts.model.tagsPosts.deleteMany({
      where: {
        tagId: tag.id,
      },
    });

    return tag;
  }

  createComment(
    orgId: string,
    userId: string | null,
    postId: string,
    content: string,
    extra:
      | CommentKind
      | {
          kind?: CommentKind;
          displayName?: string;
          parentId?: string;
          anchorStart?: number;
          anchorEnd?: number;
          anchorQuote?: string;
        } = {}
  ) {
    if (typeof extra === 'string') extra = { kind: extra };
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
        kind: extra.kind || 'COMMENT',
        displayName: extra.displayName ?? null,
        parentId: extra.parentId ?? null,
        anchorStart: extra.anchorStart ?? null,
        anchorEnd: extra.anchorEnd ?? null,
        anchorQuote: extra.anchorQuote ?? null,
      },
    });
  }

  async getPostByForWebhookId(postId: string, integrationId: string) {
    const select = {
      id: true,
      content: true,
      publishDate: true,
      releaseURL: true,
      state: true,
      integration: {
        select: {
          id: true,
          name: true,
          providerIdentifier: true,
          picture: true,
          type: true,
        },
      },
    };

    const posts = await this._post.model.post.findMany({
      where: {
        id: postId,
        deletedAt: null,
        parentPostId: null,
      },
      select,
    });

    if (posts.length) {
      return posts;
    }

    // The running workflows pass the platform's post id, which updatePost
    // already stored on the row as releaseId before the webhook is sent.
    return this._post.model.post.findMany({
      where: {
        releaseId: postId,
        integrationId,
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        updatedAt: 'desc' as const,
      },
      take: 1,
      select,
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  getErrorPosts(orgId: string, profileId?: string, limit = 50) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
        state: 'ERROR',
        OR: [{ profileId: null }, { profile: { deletedAt: null } }],
        updatedAt: { gte: dayjs.utc().subtract(30, 'day').toDate() },
        ...(profileId ? { profileId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        // NAO selecionar `error`: Post.error e uma serializacao completa da
        // excecao e pode conter refresh_token/client_secret (details[].body de
        // RefreshToken/BadBody). A tela de Status so precisa da contagem por canal.
        id: true,
        updatedAt: true,
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            internalId: true,
            name: true,
            picture: true,
          },
        },
        profile: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async getComments(postId: string, orgId?: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        content: true,
        userId: true,
        guestName: true,
        kind: true,
        createdAt: true,
        // Identidade do autor só no caminho autenticado (orgId presente). O
        // endpoint publico/guest (sem orgId) NAO expoe e-mail/nome da equipe.
        ...(orgId ? { user: { select: { email: true, name: true } } } : {}),
      },
    });
  }

  async getPostProfileScope(orgId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId: orgId, deletedAt: null },
      select: { id: true, profileId: true },
    });
  }
}
