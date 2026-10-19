import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
  HttpException,
  ConflictException,
} from '@nestjs/common';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { decryptIntegrationToken } from '@gitroom/nestjs-libraries/crypto/integration-token.helper';
import { SocialCommentsRepository } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.repository';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { GetSocialCommentsDto } from '@gitroom/nestjs-libraries/dtos/comments/get.social.comments.dto';
import { SocialCommentDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { randomUUID } from 'crypto';

// Where a reply came from. 'human' is a person acting in the UI, 'automation'
// is anything else (the public API, an agent, n8n).
export type ReplySource = 'human' | 'automation';

// The approval rule, in one place: nothing an automation wrote reaches the
// network until a human approves it, unless the organization opted into
// automatic replies.
export const shouldSendReplyNow = (
  source: ReplySource,
  autoReplyEnabled: boolean
) => source === 'human' || autoReplyEnabled;

// Only comments we have never stored before, so a poll that overlaps the
// previous one doesn't re-notify about the same comment.
export const unseenComments = (
  comments: SocialCommentDetails[],
  knownProviderIds: string[]
) =>
  [
    ...new Map(comments.map((comment) => [comment.id, comment])).values(),
  ].filter((comment) => !knownProviderIds.includes(comment.id));

@Injectable()
export class SocialCommentsService {
  constructor(
    private _socialCommentsRepository: SocialCommentsRepository,
    private _integrationManager: IntegrationManager,
    private _encryption: EncryptionService,
    private _webhooksService: WebhooksService
  ) {}

  async getComments(
    orgId: string,
    query: GetSocialCommentsDto,
    profileId?: string
  ) {
    const [comments, count] = await Promise.all([
      this._socialCommentsRepository.getComments(orgId, query, profileId),
      this._socialCommentsRepository.countComments(orgId, query, profileId),
    ]);

    return { comments, count };
  }

  async getComment(orgId: string, id: string, profileId?: string) {
    const comment = await this._socialCommentsRepository.getComment(
      orgId,
      id,
      profileId
    );
    if (!comment) {
      return undefined;
    }

    // The integration row carries the access token - it never leaves here.
    return {
      ...comment,
      integration: {
        id: comment.integration.id,
        name: comment.integration.name,
        picture: comment.integration.picture,
        providerIdentifier: comment.integration.providerIdentifier,
      },
    };
  }

  getAutoReply(orgId: string) {
    return this._socialCommentsRepository.isAutoReplyEnabled(orgId);
  }

  setAutoReply(orgId: string, autoReplyComments: boolean) {
    return this._socialCommentsRepository.setAutoReply(
      orgId,
      autoReplyComments
    );
  }

  async reply(
    orgId: string,
    id: string,
    message: string,
    source: ReplySource,
    profileId?: string
  ) {
    const comment = await this._socialCommentsRepository.getComment(
      orgId,
      id,
      profileId
    );
    if (!comment) {
      throw new BadRequestException('Comment not found');
    }

    const autoReplyEnabled =
      await this._socialCommentsRepository.isAutoReplyEnabled(orgId);

    if (!shouldSendReplyNow(source, autoReplyEnabled)) {
      await this._socialCommentsRepository.saveSuggestion(comment.id, message);
      return { id: comment.id, status: 'PENDING_APPROVAL' };
    }

    const provider = this._integrationManager.getSocialIntegration(
      comment.integration.providerIdentifier
    );

    if (!provider?.replyToComment) {
      throw new BadRequestException(
        `${comment.integration.providerIdentifier} cannot reply to comments`
      );
    }

    await provider.replyToComment(
      decryptIntegrationToken(this._encryption, comment.integration.token),
      comment.providerCommentId,
      message,
      comment.integration as any
    );

    await this._socialCommentsRepository.markReplied(comment.id, message);

    return { id: comment.id, status: 'REPLIED' };
  }

  async getPostData(orgId: string, postId: string, profileId?: string) {
    const post = await this._socialCommentsRepository.getPostToRefresh(
      orgId,
      postId,
      profileId
    );
    if (!post) throw new NotFoundException('Published post not found');
    const cached = await ioRedis.get(`post-engagement:${orgId}:${post.id}`);
    return cached ? JSON.parse(cached) : { checkedAt: null, metrics: [] };
  }

  async refreshPost(orgId: string, postId: string, profileId?: string) {
    const post = await this._socialCommentsRepository.getPostToRefresh(
      orgId,
      postId,
      profileId
    );
    if (!post) throw new NotFoundException('Published post not found');
    if (
      !this._integrationManager.getSocialIntegration(
        post.integration.providerIdentifier
      )?.listComments
    ) {
      throw new BadRequestException(
        'This channel does not support comment synchronization'
      );
    }
    try {
      await this.pollPost(post, true);
      return this.getPostData(orgId, postId, profileId);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      // Provider exceptions may contain request URLs/tokens. Never return them.
      throw new HttpException(
        'Could not refresh post data. Check the channel connection and try again.',
        502
      );
    }
  }

  // Keep the existing Temporal activity contract; sinceDays is retained for
  // workflow compatibility, while the cursor now covers the entire history.
  async pollComments(_sinceDays: number) {
    const providers = socialIntegrationList
      .filter((p) => !!p.listComments)
      .map((p) => p.identifier);
    if (!providers.length) return { posts: 0, comments: 0 };
    const cursorKey = 'comments-poll-history-cursor-v1';
    const after = await ioRedis.get(cursorKey);
    const posts = await this._socialCommentsRepository.getPostsToPoll(
      providers,
      after || undefined
    );
    let stored = 0;
    let processed = 0;
    const deadline = Date.now() + 5 * 60_000;
    for (const post of posts) {
      if (Date.now() >= deadline) break;
      try {
        stored += await this.pollPost(post);
      } catch {
        Logger.warn(
          `Could not refresh post engagement for ${post.id}`,
          SocialCommentsService.name
        );
      }
      processed++;
      await ioRedis.set(cursorKey, post.id);
    }
    if (!posts.length) await ioRedis.del(cursorKey);
    return { posts: processed, comments: stored };
  }

  private async pollPost(
    post: {
      id: string;
      releaseId: string;
      organizationId: string;
      integration: {
        id: string;
        internalId?: string;
        token: string;
        providerIdentifier: string;
      };
    },
    manual = false
  ) {
    const provider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!provider?.listComments) {
      return 0;
    }

    const cacheKey = `post-engagement:${post.organizationId}:${post.id}`;
    const lockKey = `${cacheKey}:lock`;
    const lock = randomUUID();
    if ((await ioRedis.set(lockKey, lock, 'EX', 600, 'NX')) !== 'OK') {
      if (manual)
        throw new ConflictException('Post synchronization is already in progress. Try again shortly.');
      return 0;
    }
    try {
      const previous = JSON.parse((await ioRedis.get(cacheKey)) || '{}');
      const age =
        Date.now() -
        Date.parse(
          (manual ? previous.commentsFetchedAt : previous.checkedAt) || ''
        );
      // Automatic passes refresh each post up to four times a day. Manual reads
      // have a short cooldown to protect the provider quota from repeated clicks.
      if (
        (manual || previous.commentsComplete !== false) &&
        age < (manual ? 30_000 : 6 * 60 * 60 * 1000)
      )
        return 0;
      const token = decryptIntegrationToken(
        this._encryption,
        post.integration.token
      );
      const cursorKey = `${cacheKey}:comments-cursor`;
      const page = provider.listCommentsPage
        ? await provider.listCommentsPage(
            token,
            post.releaseId,
            post.integration as any,
            (await ioRedis.get(cursorKey)) || undefined
          )
        : {
            comments: await provider.listComments(
              token,
              post.releaseId,
              post.integration as any
            ),
            nextCursor: undefined,
          };
      const comments = page.comments;
      const known = await this._socialCommentsRepository.getKnownProviderIds(
        post.integration.id,
        comments.map((c) => c.id)
      );
      const fresh = unseenComments(comments, known);
      const inserted = fresh.length
        ? await this._socialCommentsRepository.createComments(
            post.organizationId,
            post.integration.id,
            post.id,
            fresh
          )
        : [];
      const insertedIds = new Set(inserted.map((c) => c.providerCommentId));
      const created = fresh.filter((c) => insertedIds.has(c.id));
      let metrics = previous.metrics || [];
      let metricsCheckedAt = previous.metricsCheckedAt || null;
      let metricsAvailable = previous.metricsAvailable || false;
      if (!page.nextCursor && provider.postAnalytics) {
        metricsAvailable = false;
        try {
          const result = await provider.postAnalytics(
            post.integration.internalId || post.integration.id,
            token,
            post.releaseId,
            7,
            post.integration as any
          );
          if (result?.length) {
            metrics = result;
            metricsCheckedAt = new Date().toISOString();
            metricsAvailable = true;
          }
        } catch {
          /* Keep the last successful metrics when insights are unavailable. */
        }
      }
      await ioRedis.set(
        cacheKey,
        JSON.stringify({
          checkedAt: page.nextCursor
            ? previous.checkedAt || null
            : new Date().toISOString(),
          commentsFetchedAt: new Date().toISOString(),
          commentsComplete: !page.nextCursor,
          metrics,
          metricsCheckedAt,
          metricsAvailable,
        }),
        'EX',
        30 * 86400
      );

      if (page.nextCursor)
        await ioRedis.set(cursorKey, page.nextCursor, 'EX', 30 * 86400);
      else await ioRedis.del(cursorKey);

      // Deliveries retry for up to a minute and a half per webhook, and the poll
      // walks posts one by one - awaiting here would let a dead endpoint time the
      // whole activity out. sendEvent can still throw on a DB error, so the
      // rejection is caught rather than left floating.
      if (created.length)
        void this._webhooksService
          .sendEvent(
            post.organizationId,
            'comment.received',
            post.integration.id,
            created.map((comment) => ({
              ...comment,
              postId: post.id,
              integrationId: post.integration.id,
              providerIdentifier: post.integration.providerIdentifier,
            }))
          )
          .catch(() => {
            /** a webhook must never break the poll **/
          });

      return created.length;
    } finally {
      // Only release our own lease; a slow provider cannot delete a newer lock.
      await ioRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lock
      );
    }
  }
}
