import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PostsRepository } from '../database/prisma/posts/posts.repository';
import {
  NeuralTalkDeliveryError,
  NeuralTalkDeliveryStore,
} from './social/neuraltalk.provider';
@Injectable()
export class NeuralTalkDeliveryService implements NeuralTalkDeliveryStore {
  constructor(private posts: PostsRepository) {}
  private operationId(context: {
    organizationId: string;
    profileId?: string | null;
    integrationId: string;
    postId: string;
    target: string;
  }) {
    return (
      'neuraltalk:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            context.organizationId,
            context.profileId ?? null,
            context.integrationId,
            context.postId,
            context.target,
          ])
        )
        .digest('hex')
    );
  }

  async preview(
    organizationId: string,
    profileId: string | undefined,
    postId: string
  ) {
    const post = await this.posts.getRecipientPreviewPost(
      organizationId,
      profileId,
      postId
    );
    if (!post || post.integration.providerIdentifier !== 'neuraltalk')
      throw new NotFoundException('Post not found');
    let settings: unknown;
    try {
      settings = JSON.parse(post.settings || '{}');
    } catch {
      settings = null;
    }
    const savedTargets = (settings as { targets?: unknown } | null)?.targets;
    const targets = Array.isArray(savedTargets)
      ? [
          ...new Set(
            savedTargets.filter(
              (target): target is string =>
                typeof target === 'string' &&
                /^(contact|group):[1-9]\d*$/.test(target)
            )
          ),
        ].slice(0, 50)
      : [];
    const ids = targets.map((target) =>
      this.operationId({
        ...post,
        profileId: post.integration.profileId,
        postId,
        target,
      })
    );
    const operations = targets.length
      ? await this.posts.getPostOperations(
          ids,
          organizationId,
          post.integration.profileId
        )
      : [];
    const receipts = new Map(
      operations.map((operation) => [operation.id, operation.result])
    );
    const publishedIds = new Set((post.releaseId || '').split(','));
    return {
      integrationId: post.integrationId,
      recipients: targets.map((target, index) => {
        if (!receipts.has(ids[index]))
          return { target, status: 'configured' as const };
        let result;
        try {
          result = JSON.parse(receipts.get(ids[index]) || 'null');
        } catch {
          result = null;
        }
        if (result?.rejected === true)
          return { target, status: 'rejected' as const };
        const receipt = result?.receipt;
        // A reservation or an accepted message alone does not prove delivery.
        if (
          typeof receipt?.conversationId !== 'string' ||
          typeof receipt?.messageId !== 'string' ||
          !/^[1-9]\d*$/.test(receipt.conversationId) ||
          !/^[1-9]\d*$/.test(receipt.messageId)
        ) {
          return { target, status: 'unknown' as const };
        }
        return {
          target,
          status:
            post.state === 'PUBLISHED' && publishedIds.has(receipt.messageId)
              ? ('confirmed' as const)
              : ('accepted' as const),
        };
      }),
    };
  }

  async execute(
    context: {
      organizationId: string;
      profileId?: string | null;
      integrationId: string;
      postId: string;
      target: string;
      payloadHash: string;
    },
    send: () => Promise<{ conversationId: string; messageId: string }>
  ) {
    const id = this.operationId(context);
    const reservation = await this.posts.reservePostOperation(
      id,
      context.organizationId,
      context.profileId ?? undefined,
      context.payloadHash
    );
    if (reservation.requestHash !== context.payloadHash)
      throw new NeuralTalkDeliveryError('unknown');
    if (!reservation.claimed) {
      if (!reservation.result) throw new NeuralTalkDeliveryError('unknown');
      const saved = JSON.parse(reservation.result);
      if (saved.receipt)
        return saved.receipt as { conversationId: string; messageId: string };
      throw new NeuralTalkDeliveryError('rejected');
    }
    try {
      const receipt = await send();
      await this.posts.completePostOperation(id, { receipt });
      return receipt;
    } catch (error) {
      if (
        error instanceof NeuralTalkDeliveryError &&
        error.outcome === 'rejected'
      ) {
        await this.posts.completePostOperation(id, { rejected: true });
        throw error;
      }
      // Keep unknown outcomes reserved: retrying could send the same message twice.
      throw new NeuralTalkDeliveryError('unknown');
    }
  }
}
