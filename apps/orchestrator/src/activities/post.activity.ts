import { Injectable } from '@nestjs/common';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { ssrfSafeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  AuthTokenDetails,
  PendingCheckResponse,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { decryptIntegrationToken } from '@gitroom/nestjs-libraries/crypto/integration-token.helper';
import {
  setHeartbeatDetails,
  withHeartbeat,
} from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import { assertSafePendingData } from '@gitroom/nestjs-libraries/temporal/pending-post-state';
import { selectPostWorkflowVersion } from '@gitroom/nestjs-libraries/temporal/post-workflow-version';
import {
  BadBody,
  Disconnect,
  PublishedWithError,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

const REANCHOR_GRACE_MS = 2 * 60 * 60 * 1000;

function reanchorInterval(post: any) {
  if (!post?.intervalInDays || post.state !== State.QUEUE) {
    return post;
  }

  const interval = post.intervalInDays * 24 * 60 * 60 * 1000;
  const late = Date.now() - new Date(post.publishDate).getTime();
  if (late <= REANCHOR_GRACE_MS) {
    return post;
  }

  const next =
    new Date(post.publishDate).getTime() +
    Math.ceil(late / interval) * interval;

  return { ...post, publishDate: new Date(next) };
}

@Injectable()
@Activity()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _subscriptionService: SubscriptionService,
    private _flowsService: FlowsService,
    private _encryption: EncryptionService
  ) {}
  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      await this._temporalService.client
        .getRawClient()
        .workflow.signalWithStart('postWorkflowV113', {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePost(id: string, postId: string, releaseURL: string) {
    await this.updatePostForkV114(id, postId, releaseURL);
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    if (post.deletedAt) {
      return false;
    }

    return reanchorInterval(post);
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    // only the root drives the pre-publish sleep and the repeat schedule,
    // the rest are comments
    const [root, ...comments] = getPosts.map(slimPost);

    // a thread item with no text and no media has nothing to publish
    const publishable = comments.filter(
      (comment) =>
        JSON.parse(comment.image || '[]').length ||
        stripHtmlValidation('normal', comment.content || '', true).trim()
    );

    return [reanchorInterval(root), ...publishable];
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    integration = this.withDecryptedTokenForkV114(integration);
    // kept only for in-flight postWorkflowV108 runs, which set a
    // heartbeatTimeout on this activity - removing the sender would kill
    // them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
    // dropped once all V108 executions have drained
    return withHeartbeat(() =>
      this.handleDisconnect(integration, async () => {
        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        const newPosts = await this._postService.updateTags(
          integration.organizationId,
          posts
        );

        return getIntegration.comment(
          integration.internalId,
          postId,
          lastPostId,
          integration.token,
          await Promise.all(
            (newPosts || []).map(async (p) => ({
              id: p.id,
              message: stripHtmlValidation(
                getIntegration.editor,
                p.content,
                true,
                false,
                !/<\/?[a-z][\s\S]*>/i.test(p.content),
                getIntegration.mentionFormat
              ),
              settings: JSON.parse(p.settings || '{}'),
              media: await this._postService.updateMedia(
                p.id,
                JSON.parse(p.image || '[]'),
                getIntegration?.convertToJPEG || false
              ),
            }))
          ),
          integration
        );
      })
    );
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, false);
  }

  @ActivityMethod()
  async postSocialPending(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, true);
  }

  private async handleDisconnect<T>(
    integration: Integration,
    func: () => Promise<T>
  ): Promise<T> {
    try {
      return await func();
    } catch (err) {
      if (err instanceof Disconnect) {
        try {
          await this._integrationService.disconnectChannel(
            integration.organizationId,
            integration,
            err.message
          );
        } catch (e) {
          /**empty**/
        }

        throw new BadBody(
          integration.providerIdentifier,
          JSON.stringify({}),
          Buffer.from('{}'),
          err.message
        );
      }

      // The post is live but a follow-up mutation failed (e.g. YouTube
      // rejected the thumbnail after the upload): keep its platform id/URL on
      // the post, then fail it as BadBody like any other error - the post
      // still ends in ERROR, but the calendar can link to the live post.
      if (err instanceof PublishedWithError) {
        try {
          await this._postService.setReleaseDetails(
            err.postDbId,
            err.releaseId,
            err.releaseURL
          );
        } catch (e) {
          /**empty**/
        }

        throw new BadBody(
          integration.providerIdentifier,
          JSON.stringify({}),
          Buffer.from('{}'),
          err.message
        );
      }

      throw err;
    }
  }

  private async postSocialInternal(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    integration = this.withDecryptedTokenForkV114(integration);
    // kept only for in-flight postWorkflowV108 runs, which set a
    // heartbeatTimeout on this activity - removing the sender would kill
    // them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
    // dropped once all V108 executions have drained
    return withHeartbeat(() =>
      this.handleDisconnect(integration, () =>
        this.postSocialBody(integration, posts, allowPending)
      )
    );
  }

  private async postSocialBody(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    // Stage markers: whatever ran last is what a timed-out activity reports.
    // Providers that go through this.fetch overwrite these with the exact URL;
    // the ones on their own HTTP client (x, youtube, bluesky) are still
    // narrowed down to the step they hung on.
    setHeartbeatDetails('subscription lookup');
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    setHeartbeatDetails('update tags');
    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    setHeartbeatDetails('resolve media');
    const mappedPosts = await Promise.all(
      (newPosts || []).map(async (p) => ({
        id: p.id,
        message: stripHtmlValidation(
          getIntegration.editor,
          p.content,
          true,
          false,
          !/<\/?[a-z][\s\S]*>/i.test(p.content),
          getIntegration.mentionFormat,
          !!getIntegration.inlineImages?.(JSON.parse(p.settings || '{}'))
        ),
        settings: JSON.parse(p.settings || '{}'),
        media: await this._postService.updateMedia(
          p.id,
          JSON.parse(p.image || '[]'),
          getIntegration?.convertToJPEG || false
        ),
      }))
    );

    setHeartbeatDetails(`${integration.providerIdentifier}: publish`);
    const postNow =
      allowPending && getIntegration.postPending
        ? await getIntegration.postPending(
            integration.internalId,
            integration.token,
            mappedPosts,
            integration
          )
        : await getIntegration.post(
            integration.internalId,
            integration.token,
            mappedPosts,
            integration
          );

    // The post is already published at this point: the streak is best-effort,
    // failing the activity here would retry it and publish again.
    setHeartbeatDetails(`${integration.providerIdentifier}: published, streak`);
    try {
      await this._temporalService.client
        .getRawClient()
        .workflow.start('streakWorkflowV3', {
          args: [{ organizationId: integration.organizationId }],
          workflowId: `streak_${integration.organizationId}`,
          taskQueue: 'main',
          // Keep a running streak, it checks for newer posts before it ends
          workflowIdConflictPolicy: 'USE_EXISTING',
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationId,
              value: integration.organizationId,
            },
          ]),
        });
    } catch (err) {
      /**empty**/
    }

    return postNow;
  }

  @ActivityMethod()
  async checkPostStatus(integration: Integration, pendingData: any) {
    integration = this.withDecryptedTokenForkV114(integration);
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return this.handleDisconnect(integration, () =>
      getIntegration.checkPostStatus(
        integration.token,
        pendingData,
        integration
      )
    );
  }

  @ActivityMethod()
  async finalizePost(integration: Integration, pendingData: any) {
    integration = this.withDecryptedTokenForkV114(integration);
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return withHeartbeat(() =>
      this.handleDisconnect(integration, () =>
        getIntegration.finalizePost(integration.token, pendingData, integration)
      )
    );
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    // Webhooks are best-effort and run after the post already published, so a
    // failure here must not fail the workflow. Individual delivery failures are
    // recorded by the dispatcher instead of being dropped.
    try {
      const post = await this._postService.getPostByForWebhookId(
        postId,
        integrationId
      );

      await this._webhookService.sendEvent(
        orgId,
        'post.published',
        integrationId,
        post
      );
    } catch (err) {
      /**empty**/
    }
  }

  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        (err as Error)?.message || ''
      );
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        cause || (err as Error)?.message || ''
      );
      return false;
    }
  }
  @ActivityMethod()
  async getIntegrationByIdForkV114(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPostsForkV114() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      const workflowName = selectPostWorkflowVersion({
        integrationId: post.integration.id,
        providerIdentifier: post.integration.providerIdentifier,
      });
      await this._temporalService.client
        .getRawClient()
        .workflow.signalWithStart(workflowName, {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier.startsWith(
                'zernio-'
              )
                ? 'main'
                : post.integration.providerIdentifier
                    .split('-')[0]
                    .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePostForkV114(id: string, postId: string, releaseURL: string) {
    const result = await this._postService.updatePost(id, postId, releaseURL);

    // Bind any pending "next_publication" flows to this freshly published
    // media. Stories are excluded. Failures must never break the publish.
    try {
      if (!postId) return result;
      const post = result
        ? await this._postService.getPostById(id, result.organizationId)
        : undefined;
      if (!post || post.integration?.providerIdentifier !== 'instagram') {
        return result;
      }
      let settings: any = {};
      try {
        settings = JSON.parse(post.settings || '{}');
      } catch {
        settings = {};
      }
      if (settings?.post_type === 'story') return result;
      await this._flowsService.bindPendingFlowsToPost(
        post.integrationId,
        postId
      );
    } catch {
      // ignore — bind errors must not fail the post publish
    }

    return result;
  }

  @ActivityMethod()
  async getPostV114(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }

    const [post] = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId,
      true
    );
    return post
      ? this.sanitizePostForWorkflowForkV114(reanchorInterval(post))
      : false;
  }

  @ActivityMethod()
  async getPostsListForkV114(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts;
  }

  @ActivityMethod()
  async getPostsListV114(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId,
      true
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts.map((post) => this.sanitizePostForWorkflowForkV114(post));
  }

  @ActivityMethod()
  async isCommentableForkV114(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async isCommentableForWorkflowForkV114(providerIdentifier: string) {
    const provider =
      this._integrationManager.getSocialIntegration(providerIdentifier);
    return !!provider.comment;
  }

  @ActivityMethod()
  async postCommentForkV114(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    return withHeartbeat(async () => {
      const runtimeIntegration = this.withDecryptedTokenForkV114(integration);
      const getIntegration = this._integrationManager.getSocialIntegration(
        runtimeIntegration.providerIdentifier
      );

      setHeartbeatDetails(`${runtimeIntegration.providerIdentifier}: comment`);
      const newPosts = await this._postService.updateTags(
        runtimeIntegration.organizationId,
        posts
      );

      return getIntegration.comment(
        runtimeIntegration.internalId,
        postId,
        lastPostId,
        runtimeIntegration.token,
        await this.mapPostsForkV114(getIntegration, newPosts || []),
        runtimeIntegration
      );
    });
  }

  @ActivityMethod()
  async postCommentV114(
    postId: string,
    lastPostId: string | undefined,
    organizationId: string,
    integrationId: string,
    posts: Post[]
  ) {
    return withHeartbeat(async () => {
      const runtimeIntegration = await this.loadRuntimeIntegrationForkV114(
        organizationId,
        integrationId
      );
      const provider = this._integrationManager.getSocialIntegration(
        runtimeIntegration.providerIdentifier
      );

      setHeartbeatDetails(`${runtimeIntegration.providerIdentifier}: comment`);
      const newPosts = await this._postService.updateTags(
        runtimeIntegration.organizationId,
        posts
      );

      return provider.comment(
        runtimeIntegration.internalId,
        postId,
        lastPostId,
        runtimeIntegration.token,
        await this.mapPostsForkV114(provider, newPosts || []),
        runtimeIntegration
      );
    });
  }

  @ActivityMethod()
  async postSocialPendingForkV114(
    organizationId: string,
    integrationId: string,
    posts: Post[]
  ): Promise<PostResponse[]> {
    return withHeartbeat(async () => {
      const runtimeIntegration = await this.loadRuntimeIntegrationForkV114(
        organizationId,
        integrationId
      );
      const getIntegration = this._integrationManager.getSocialIntegration(
        runtimeIntegration.providerIdentifier
      );

      setHeartbeatDetails('update tags');
      const newPosts = await this._postService.updateTags(
        runtimeIntegration.organizationId,
        posts
      );
      setHeartbeatDetails('resolve media');
      const mappedPosts = await this.mapPostsForkV114(
        getIntegration,
        newPosts || []
      );
      setHeartbeatDetails(`${runtimeIntegration.providerIdentifier}: publish`);

      const response = getIntegration.postPending
        ? await getIntegration.postPending(
            runtimeIntegration.internalId,
            runtimeIntegration.token,
            mappedPosts,
            runtimeIntegration
          )
        : await getIntegration.post(
            runtimeIntegration.internalId,
            runtimeIntegration.token,
            mappedPosts,
            runtimeIntegration
          );

      const validated = response.map((item) =>
        item.status === 'pending'
          ? { ...item, pendingData: assertSafePendingData(item.pendingData) }
          : item
      );

      setHeartbeatDetails(
        `${runtimeIntegration.providerIdentifier}: published, streak`
      );
      try {
        await this.startStreakForkV114(runtimeIntegration.organizationId);
      } catch {
        // A notification/telemetry failure after publishing must not repeat it.
      }

      return validated;
    });
  }

  @ActivityMethod()
  async checkPostStatusForkV114(
    organizationId: string,
    integrationId: string,
    pendingData: unknown
  ): Promise<PendingCheckResponse> {
    const runtimeIntegration = await this.loadRuntimeIntegrationForkV114(
      organizationId,
      integrationId
    );
    const provider = this._integrationManager.getSocialIntegration(
      runtimeIntegration.providerIdentifier
    );
    if (!provider.checkPostStatus) {
      throw new Error('Provider does not implement checkPostStatus');
    }

    const result = await provider.checkPostStatus(
      runtimeIntegration.token,
      assertSafePendingData(pendingData),
      runtimeIntegration
    );
    return this.validatePendingCheckResponseForkV114(result);
  }

  @ActivityMethod()
  async finalizePostForkV114(
    organizationId: string,
    integrationId: string,
    pendingData: unknown
  ): Promise<PendingCheckResponse> {
    return withHeartbeat(async () => {
      const runtimeIntegration = await this.loadRuntimeIntegrationForkV114(
        organizationId,
        integrationId
      );
      const provider = this._integrationManager.getSocialIntegration(
        runtimeIntegration.providerIdentifier
      );
      if (!provider.finalizePost) {
        throw new Error('Provider does not implement finalizePost');
      }

      setHeartbeatDetails(`${runtimeIntegration.providerIdentifier}: finalize`);
      const result = await provider.finalizePost(
        runtimeIntegration.token,
        assertSafePendingData(pendingData),
        runtimeIntegration
      );
      return this.validatePendingCheckResponseForkV114(result);
    });
  }

  @ActivityMethod()
  async postSocialForkV114(integration: Integration, posts: Post[]) {
    integration.token = decryptIntegrationToken(
      this._encryption,
      integration.token
    );
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const postNow = await getIntegration.post(
      integration.internalId,
      integration.token,
      await Promise.all(
        (newPosts || []).map(async (p) => ({
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings: JSON.parse(p.settings || '{}'),
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false
          ),
        }))
      ),
      integration
    );

    await this._temporalService.client
      .getRawClient()
      .workflow.start('streakWorkflowV3', {
        args: [{ organizationId: integration.organizationId }],
        workflowId: `streak_${integration.organizationId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationId,
            value: integration.organizationId,
          },
        ]),
      });

    return postNow;
  }

  private withDecryptedTokenForkV114(integration: Integration): Integration {
    return {
      ...integration,
      token: decryptIntegrationToken(this._encryption, integration.token),
    };
  }

  private async loadRuntimeIntegrationForkV114(
    organizationId: string,
    integrationId: string
  ): Promise<Integration> {
    return this.withDecryptedTokenForkV114(
      await this.loadIntegrationForkV114(organizationId, integrationId)
    );
  }

  private async loadIntegrationForkV114(
    organizationId: string,
    integrationId: string
  ): Promise<Integration> {
    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration) {
      throw new Error('Integration not found');
    }
    return integration;
  }

  private sanitizePostForWorkflowForkV114(post: any) {
    const safePost: any = { ...post };
    delete safePost.error;
    delete safePost.childrenPost;
    if (!post.integration) {
      return safePost;
    }
    const integration = post.integration;
    return {
      ...safePost,
      integration: {
        id: integration.id,
        organizationId: integration.organizationId,
        profileId: integration.profileId,
        providerIdentifier: integration.providerIdentifier,
        name: integration.name,
        disabled: integration.disabled,
        refreshNeeded: integration.refreshNeeded,
      },
    };
  }

  private mapPostsForkV114(getIntegration: any, posts: Post[]) {
    return Promise.all(
      posts.map(async (post) => ({
        id: post.id,
        message: stripHtmlValidation(
          getIntegration.editor,
          post.content,
          true,
          false,
          !/<\/?[a-z][\s\S]*>/i.test(post.content),
          getIntegration.mentionFormat
        ),
        settings: JSON.parse(post.settings || '{}'),
        media: await this._postService.updateMedia(
          post.id,
          JSON.parse(post.image || '[]'),
          getIntegration?.convertToJPEG || false
        ),
      }))
    );
  }

  private validatePendingCheckResponseForkV114(
    response: PendingCheckResponse
  ): PendingCheckResponse {
    return response.status === 'completed'
      ? response
      : {
          ...response,
          pendingData: assertSafePendingData(response.pendingData),
        };
  }

  private startStreakForkV114(organizationIdValue: string) {
    return this._temporalService.client
      .getRawClient()
      .workflow.start('streakWorkflowV3', {
        args: [{ organizationId: organizationIdValue }],
        workflowId: `streak_${organizationIdValue}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationId,
            value: organizationIdValue,
          },
        ]),
      });
  }

  @ActivityMethod()
  async inAppNotificationForkV114(
    orgId: string,
    payload: {
      subjectKey: string;
      messageKey: string;
      params?: Record<string, string | number | undefined>;
      profileId?: string | null;
    },
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    return this._notificationService.inAppNotification(
      orgId,
      payload,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugsForkV114(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async globalPlugsForWorkflowForkV114(
    organizationId: string,
    integrationId: string
  ) {
    return this.globalPlugsForkV114(
      await this.loadIntegrationForkV114(organizationId, integrationId)
    );
  }

  @ActivityMethod()
  async changeStateForkV114(id: string, state: State, err?: any, body?: any) {
    return this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugsForkV114(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async internalPlugsForWorkflowForkV114(
    organizationId: string,
    integrationId: string,
    settings: any
  ) {
    return this.internalPlugsForkV114(
      await this.loadIntegrationForkV114(organizationId, integrationId),
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooksForkV114(
    postId: string,
    orgId: string,
    integrationId: string
  ) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(
      postId,
      integrationId
    );
    return Promise.all(
      webhooks.map(async (webhook) => {
        try {
          await ssrfSafeFetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(post),
          });
        } catch (e) {
          /**empty**/
        }
      })
    );
  }

  @ActivityMethod()
  async processPlugForkV114(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlugForkV114(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    return this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshTokenForkV114(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCauseForkV114(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenForWorkflowForkV114(
    organizationId: string,
    integrationId: string,
    cause: string
  ): Promise<boolean> {
    let integration: Integration;
    try {
      integration = await this.loadIntegrationForkV114(
        organizationId,
        integrationId
      );
    } catch {
      return false;
    }
    return !!(await this.refreshTokenWithCauseForkV114(integration, cause));
  }
}
