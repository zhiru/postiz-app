import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, SocialCommentStatus } from '@prisma/client';
import { SocialCommentDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { GetSocialCommentsDto } from '@gitroom/nestjs-libraries/dtos/comments/get.social.comments.dto';

const commentSelect = {
  id: true,
  integrationId: true,
  postId: true,
  providerCommentId: true,
  parentCommentId: true,
  content: true,
  authorName: true,
  authorId: true,
  permalink: true,
  publishedAt: true,
  status: true,
  suggestedReply: true,
  reply: true,
  repliedAt: true,
  integration: {
    select: {
      id: true,
      name: true,
      picture: true,
      providerIdentifier: true,
    },
  },
};

@Injectable()
export class SocialCommentsRepository {
  constructor(
    private _socialComments: PrismaRepository<'socialComments'>,
    private _post: PrismaRepository<'post'>,
    private _organization: PrismaRepository<'organization'>
  ) {}

  private postSelect = {
    id: true,
    releaseId: true,
    organizationId: true,
    integration: {
      select: {
        id: true,
        internalId: true,
        token: true,
        organizationId: true,
        profileId: true,
        additionalSettings: true,
        providerIdentifier: true,
      },
    },
  } as const;

  private publishedPostWhere: Prisma.PostWhereInput = {
    state: 'PUBLISHED' as const,
    deletedAt: null,
    parentPostId: null,
    OR: [
      { intervalInDays: null },
      { platformHistoryCovered: false, recurringSnapshots: { none: {} } },
    ],
    releaseId: { not: null },
  };

  getPostToRefresh(orgId: string, postId: string, profileId?: string) {
    return this._post.model.post.findFirst({
      where: {
        ...this.publishedPostWhere,
        id: postId,
        organizationId: orgId,
        integration: {
          organizationId: orgId,
          deletedAt: null,
          ...(profileId ? { profileId } : {}),
        },
      },
      select: this.postSelect,
    });
  }

  // Walk the entire history, including old posts receiving new comments. Keyset
  // pagination avoids starving old posts behind the newest 200 on every cycle.
  getPostsToPoll(providerIdentifiers: string[], afterId?: string) {
    const configured = Number(process.env.COMMENTS_POLL_MAX_POSTS || 100);
    const take = Number.isFinite(configured)
      ? Math.min(200, Math.max(1, Math.floor(configured)))
      : 100;
    return this._post.model.post.findMany({
      where: {
        ...this.publishedPostWhere,
        ...(afterId ? { id: { gt: afterId } } : {}),
        integration: {
          deletedAt: null,
          refreshNeeded: false,
          inBetweenSteps: false,
          providerIdentifier: { in: providerIdentifiers },
        },
      },
      orderBy: { id: 'asc' },
      take,
      select: this.postSelect,
    });
  }

  async getKnownProviderIds(integrationId: string, providerIds: string[]) {
    const rows = await this._socialComments.model.socialComments.findMany({
      where: {
        integrationId,
        providerCommentId: {
          in: providerIds,
        },
      },
      select: {
        providerCommentId: true,
      },
    });

    return rows.map((r) => r.providerCommentId);
  }

  createComments(
    orgId: string,
    integrationId: string,
    postId: string,
    comments: SocialCommentDetails[]
  ) {
    return this._socialComments.model.socialComments.createManyAndReturn({
      // The unique index on (integrationId, providerCommentId) is the real
      // guarantee: two overlapping polls can't insert the same comment twice.
      skipDuplicates: true,
      select: { providerCommentId: true },
      data: comments.map((comment) => ({
        organizationId: orgId,
        integrationId,
        postId,
        providerCommentId: comment.id,
        parentCommentId: comment.parentId,
        content: comment.content,
        authorName: comment.authorName,
        authorId: comment.authorId,
        permalink: comment.permalink,
        publishedAt: new Date(comment.publishedAt),
      })),
    });
  }

  getComments(orgId: string, query: GetSocialCommentsDto, profileId?: string) {
    const page = query.page || 1;
    const take = 20;

    return this._socialComments.model.socialComments.findMany({
      where: {
        organizationId: orgId,
        ...(profileId
          ? {
              integration: {
                profileId,
                organizationId: orgId,
                deletedAt: null,
              },
            }
          : {}),
        ...(query.integrationId ? { integrationId: query.integrationId } : {}),
        ...(query.postId ? { postId: query.postId } : {}),
        ...(query.status
          ? { status: query.status as SocialCommentStatus }
          : {}),
      },
      orderBy: {
        publishedAt: 'desc' as const,
      },
      skip: (page - 1) * take,
      take,
      select: commentSelect,
    });
  }

  countComments(
    orgId: string,
    query: GetSocialCommentsDto,
    profileId?: string
  ) {
    return this._socialComments.model.socialComments.count({
      where: {
        organizationId: orgId,
        ...(profileId
          ? {
              integration: {
                profileId,
                organizationId: orgId,
                deletedAt: null,
              },
            }
          : {}),
        ...(query.integrationId ? { integrationId: query.integrationId } : {}),
        ...(query.postId ? { postId: query.postId } : {}),
        ...(query.status
          ? { status: query.status as SocialCommentStatus }
          : {}),
      },
    });
  }

  getComment(orgId: string, id: string, profileId?: string) {
    return this._socialComments.model.socialComments.findFirst({
      where: {
        id,
        organizationId: orgId,
        ...(profileId
          ? {
              integration: {
                profileId,
                organizationId: orgId,
                deletedAt: null,
              },
            }
          : {}),
      },
      select: {
        ...commentSelect,
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            providerIdentifier: true,
            token: true,
            organizationId: true,
            profileId: true,
            additionalSettings: true,
          },
        },
      },
    });
  }

  saveSuggestion(id: string, suggestedReply: string) {
    return this._socialComments.model.socialComments.update({
      where: {
        id,
      },
      data: {
        suggestedReply,
        status: 'PENDING_APPROVAL',
      },
      select: {
        id: true,
      },
    });
  }

  markReplied(id: string, reply: string) {
    return this._socialComments.model.socialComments.update({
      where: {
        id,
      },
      data: {
        reply,
        repliedAt: new Date(),
        status: 'REPLIED',
      },
      select: {
        id: true,
      },
    });
  }

  async isAutoReplyEnabled(orgId: string) {
    const organization = await this._organization.model.organization.findUnique(
      {
        where: {
          id: orgId,
        },
        select: {
          autoReplyComments: true,
        },
      }
    );

    return !!organization?.autoReplyComments;
  }

  setAutoReply(orgId: string, autoReplyComments: boolean) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        autoReplyComments,
      },
      select: {
        id: true,
      },
    });
  }
}
