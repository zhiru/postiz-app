import { BadRequestException, Injectable } from '@nestjs/common';
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
) => comments.filter((comment) => !knownProviderIds.includes(comment.id));

@Injectable()
export class SocialCommentsService {
  constructor(
    private _socialCommentsRepository: SocialCommentsRepository,
    private _integrationManager: IntegrationManager,
    private _encryption: EncryptionService,
    private _webhooksService: WebhooksService
  ) {}

  async getComments(orgId: string, query: GetSocialCommentsDto, profileId?: string) {
    const [comments, count] = await Promise.all([
      this._socialCommentsRepository.getComments(orgId, query, profileId),
      this._socialCommentsRepository.countComments(orgId, query, profileId),
    ]);

    return { comments, count };
  }

  async getComment(orgId: string, id: string, profileId?: string) {
    const comment = await this._socialCommentsRepository.getComment(orgId, id, profileId);
    if (!comment) {
      return undefined;
    }

    // The integration row carries the access token - it never leaves here.
    return { ...comment, integration: { id: comment.integration.id, name: comment.integration.name, picture: comment.integration.picture, providerIdentifier: comment.integration.providerIdentifier } };
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
    const comment = await this._socialCommentsRepository.getComment(orgId, id, profileId);
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

  // Reads the comments left on recently published posts of every provider that
  // implements listComments, stores the new ones and announces them.
  async pollComments(sinceDays: number) {
    // Generic: whoever implements listComments gets polled, nothing names a
    // network here.
    const providers = socialIntegrationList
      .filter((p) => !!p.listComments)
      .map((p) => p.identifier);

    if (!providers.length) {
      return { posts: 0, comments: 0 };
    }

    const posts = await this._socialCommentsRepository.getPostsToPoll(
      providers,
      sinceDays
    );

    let stored = 0;
    for (const post of posts) {
      try {
        stored += await this.pollPost(post);
      } catch (err) {
        // One channel being rate limited or disconnected must not stop the
        // rest of the cycle.
      }
    }

    return { posts: posts.length, comments: stored };
  }

  private async pollPost(post: {
    id: string;
    releaseId: string;
    organizationId: string;
    integration: { id: string; token: string; providerIdentifier: string };
  }) {
    const provider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!provider?.listComments) {
      return 0;
    }

    const comments = await provider.listComments(
      decryptIntegrationToken(this._encryption, post.integration.token),
      post.releaseId,
      post.integration as any
    );

    if (!comments.length) {
      return 0;
    }

    const known = await this._socialCommentsRepository.getKnownProviderIds(
      post.integration.id,
      comments.map((c) => c.id)
    );

    const fresh = unseenComments(comments, known);
    if (!fresh.length) {
      return 0;
    }

    await this._socialCommentsRepository.createComments(
      post.organizationId,
      post.integration.id,
      post.id,
      fresh
    );

    // Deliveries retry for up to a minute and a half per webhook, and the poll
    // walks posts one by one - awaiting here would let a dead endpoint time the
    // whole activity out. sendEvent can still throw on a DB error, so the
    // rejection is caught rather than left floating.
    void this._webhooksService
      .sendEvent(
        post.organizationId,
        'comment.received',
        post.integration.id,
        fresh.map((comment) => ({
          ...comment,
          postId: post.id,
          integrationId: post.integration.id,
          providerIdentifier: post.integration.providerIdentifier,
        }))
      )
      .catch(() => {
        /** a webhook must never break the poll **/
      });

    return fresh.length;
  }
}
