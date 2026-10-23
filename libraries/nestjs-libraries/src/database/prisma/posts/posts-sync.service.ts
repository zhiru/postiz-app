import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { decryptIntegrationToken } from '@gitroom/nestjs-libraries/crypto/integration-token.helper';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import {
  socialIntegrationList,
  IntegrationManager,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { PostsSyncRepository } from './posts-sync.repository';
import { PostsRepository } from './posts.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

@Injectable()
export class PostsSyncService implements OnApplicationBootstrap {
  private logger = new Logger(PostsSyncService.name);
  constructor(
    private repository: PostsSyncRepository,
    private posts: PostsRepository,
    private providers: IntegrationManager,
    private temporal: TemporalService,
    private refresh: RefreshIntegrationService,
    private encryption: EncryptionService = new EncryptionService()
  ) {}

  async onApplicationBootstrap() {
    if (!process.env.RUN_CRON) return;
    try {
      await this.temporal.client
        .getRawClient()
        .workflow.start('scheduleExternalPostsSyncV1', {
          workflowId: 'external-posts-sync-scheduler-v1',
          taskQueue: 'main',
        });
    } catch (error) {
      if ((error as Error).name !== 'WorkflowExecutionAlreadyStartedError') {
        this.logger.error('Could not start external posts sync scheduler');
      }
    }
  }

  eligible() {
    const supported = (socialIntegrationList as SocialProvider[])
      .filter((provider) => !!provider.listPublishedPosts)
      .map((provider) => provider.identifier);
    return this.repository.eligible(supported);
  }

  private async channel(
    organizationId: string,
    id: string,
    profileId?: string
  ) {
    const integration = await this.repository.get(
      organizationId,
      id,
      profileId
    );
    if (!integration) throw new NotFoundException('Channel not found');
    integration.token = decryptIntegrationToken(
      this.encryption,
      integration.token
    );
    integration.refreshToken = decryptIntegrationToken(
      this.encryption,
      integration.refreshToken
    );
    const provider = this.providers.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.listPublishedPosts)
      throw new BadRequestException(
        'This channel does not support post synchronization'
      );
    return { integration, provider };
  }

  async status(organizationId: string, id: string, profileId?: string) {
    const { integration } = await this.channel(organizationId, id, profileId);
    return {
      lastSuccessAt: integration.postsSyncLastSuccessAt,
      historyCompletedAt: integration.postsSyncCompletedAt,
      runningSince: integration.postsSyncRunningSince,
      error: integration.postsSyncLastError,
    };
  }

  async request(organizationId: string, id: string, profileId?: string) {
    const { integration } = await this.channel(organizationId, id, profileId);
    if (
      integration.disabled ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      throw new BadRequestException(
        'Reconnect or enable the channel before synchronizing'
      );
    }
    try {
      await this.temporal.client
        .getRawClient()
        .workflow.start('syncExternalPostsWorkflowV1', {
          workflowId: `external-posts-sync-v1-${id}`,
          taskQueue: 'main',
          args: [{ organizationId, id }],
        });
    } catch (error) {
      if ((error as Error).name !== 'WorkflowExecutionAlreadyStartedError')
        throw error;
    }
    return { queued: true };
  }

  async prepare(organizationId: string, id: string) {
    const { integration } = await this.channel(organizationId, id);
    // Finish the initial history import, then reconcile the full history daily.
    const full =
      !integration.postsSyncCompletedAt ||
      Date.now() - integration.postsSyncCompletedAt.getTime() >= 86400000;
    await this.repository.update(organizationId, id, {
      postsSyncRunningSince: new Date(),
      postsSyncLastError: null,
    });
    return {
      full,
      cursor: full ? integration.postsSyncCursor || undefined : undefined,
    };
  }

  async page(
    organizationId: string,
    id: string,
    full: boolean,
    cursor?: string
  ) {
    let { integration, provider } = await this.channel(organizationId, id);
    if (
      integration.disabled ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    )
      throw new Error('Channel unavailable');
    let page;
    try {
      page = await provider.listPublishedPosts!(
        integration.internalId,
        integration.token,
        cursor
      );
    } catch (error) {
      if (!(error instanceof RefreshToken)) throw error;
      const auth = await this.refresh.refresh(
        integration,
        'external posts synchronization'
      );
      if (!auth) throw new Error('Channel authentication expired');
      ({ integration, provider } = await this.channel(organizationId, id));
      page = await provider.listPublishedPosts!(
        integration.internalId,
        integration.token,
        cursor
      );
    }
    if (page.nextCursor && page.nextCursor === cursor)
      throw new Error('Provider returned a repeated cursor');
    // A Story permission failure must not block successful feed reconciliation.
    if (!cursor && provider.listActiveStories)
      try {
        const stories = await provider.listActiveStories(
          integration.internalId,
          integration.token
        );
        page.posts.push(...stories.posts);
      } catch {
        this.logger.warn(
          'Active Stories could not be imported; feed synchronization continues. Check Story permissions.'
        );
      }
    let imported = 0;
    for (const item of page.posts) {
      if (
        await this.posts.importPlatformPost(
          organizationId,
          id,
          item,
          integration.profileId || undefined
        )
      )
        imported++;
    }
    if (full)
      await this.repository.update(organizationId, id, {
        postsSyncCursor: page.nextCursor || null,
      });
    return { nextCursor: page.nextCursor, imported };
  }

  async finish(organizationId: string, id: string, full: boolean) {
    if (full) {
      const { provider } = await this.channel(organizationId, id);
      const roots = await this.posts.getRecurringSyncCandidates(
        organizationId,
        id
      );
      const covered = roots.filter((root) => {
        try {
          return (
            provider.canImportPublishedPost?.(
              JSON.parse(root.settings || '{}')
            ) === true
          );
        } catch {
          return false;
        }
      });
      await this.posts.coverRecurringHistory(
        organizationId,
        id,
        covered.map((root) => root.id)
      );
    }
    await this.repository.update(organizationId, id, {
      postsSyncRunningSince: null,
      postsSyncLastSuccessAt: new Date(),
      postsSyncLastError: null,
      ...(full
        ? { postsSyncCompletedAt: new Date(), postsSyncCursor: null }
        : {}),
    });
  }

  async failed(organizationId: string, id: string) {
    // Never persist provider error bodies: they can contain tokens or signed URLs.
    await this.repository.update(organizationId, id, {
      postsSyncRunningSince: null,
      postsSyncCursor: null,
      postsSyncLastError:
        'Synchronization failed. Check the channel connection and try again.',
    });
  }
}
