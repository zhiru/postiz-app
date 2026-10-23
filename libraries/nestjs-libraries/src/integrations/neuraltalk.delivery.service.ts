import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PostsRepository } from '../database/prisma/posts/posts.repository';
import {
  NeuralTalkDeliveryError,
  NeuralTalkDeliveryStore,
} from './social/neuraltalk.provider';
@Injectable()
export class NeuralTalkDeliveryService implements NeuralTalkDeliveryStore {
  constructor(private posts: PostsRepository) {}
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
    const id =
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
        .digest('hex');
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
