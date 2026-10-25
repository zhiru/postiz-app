import { FlowMessageService } from './flows/flow-message.service';
import { PostMetricsRepository } from './analytics/post-metrics.repository';
import { PostMetricsService } from './analytics/post-metrics.service';
import { MediaTransferService } from './media/media.transfer.service';
import { MediaTransferRepository } from './media/media.transfer.repository';
import {
  NeuralTalkProvider,
  NEURALTALK_DELIVERY_STORE,
} from '../../integrations/social/neuraltalk.provider';
import { NeuralTalkConnectionService } from '../../integrations/neuraltalk.connection.service';
import { NeuralTalkDeliveryService } from '../../integrations/neuraltalk.delivery.service';
import { PostManagementService } from './posts/post.management.service';
import { AutomationDeliveryService } from './flows/automation-delivery.service';
import { Global, Module } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from './prisma.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostsSyncRepository } from './posts/posts-sync.repository';
import { PostsSyncService } from './posts/posts-sync.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@gitroom/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { DeepgramService } from '@gitroom/nestjs-libraries/deepgram/deepgram.service';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { ClippingRepository } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.repository';
import { AgenciesService } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { SocialCommentsRepository } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.repository';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { ThirdPartyRepository } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { FalService } from '@gitroom/nestjs-libraries/openai/fal.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { MetaSystemUserService } from '@gitroom/nestjs-libraries/integrations/meta-system-user.service';
import { CredentialRepository } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.repository';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { ProfileRepository } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.repository';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { StartupMigrationService } from '@gitroom/nestjs-libraries/database/prisma/startup-migration.service';
import { VectorInitService } from '@gitroom/nestjs-libraries/chat/vector/vector.init.service';
import { KnowledgeRepository } from '@gitroom/nestjs-libraries/database/prisma/knowledge/knowledge.repository';
import { KnowledgeService } from '@gitroom/nestjs-libraries/database/prisma/knowledge/knowledge.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { FlowsRepository } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.repository';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import { UnmatchedCommentService } from '@gitroom/nestjs-libraries/database/prisma/flows/unmatched-comment.service';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { ReviewLinksRepository } from '@gitroom/nestjs-libraries/database/prisma/review-links/review-links.repository';
import { ReviewLinksService } from '@gitroom/nestjs-libraries/database/prisma/review-links/review-links.service';
import { InstagramMessagingService } from '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service';
import { RepostRepository } from '@gitroom/nestjs-libraries/database/prisma/repost/repost.repository';
import { RepostService } from '@gitroom/nestjs-libraries/database/prisma/repost/repost.service';
import { StatusService } from '@gitroom/nestjs-libraries/database/prisma/status/status.service';
import { StatusEventService } from '@gitroom/nestjs-libraries/database/prisma/status/status-event.service';
import { StatusEventRepository } from '@gitroom/nestjs-libraries/database/prisma/status/status-event.repository';
import { InfraHealthService } from '@gitroom/nestjs-libraries/database/prisma/status/infra-health.service';
import { InfraHealthRepository } from '@gitroom/nestjs-libraries/database/prisma/status/infra-health.repository';
import { AiModule } from '@gitroom/nestjs-libraries/ai/ai.module';
import { ErrorsRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { AnalyticsReportRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.repository';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { InstanceCredentialsRepository } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.repository';
import { InstanceCredentialsService } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.service';

@Global()
@Module({
  imports: [AiModule],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    SocialCommentsRepository,
    SocialCommentsService,
    IntegrationService,
    IntegrationRepository,
    PostMetricsRepository,
    PostMetricsService,
    AnalyticsReportService,
    AnalyticsReportRepository,
    PostsService,
    PostManagementService,
    PostsRepository,
    PostsSyncRepository,
    PostsSyncService,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    SignatureRepository,
    AutopostRepository,
    AutopostService,
    SignatureService,
    MediaService,
    MediaTransferService,
    MediaTransferRepository,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    NeuralTalkProvider,
    NeuralTalkConnectionService,
    NeuralTalkDeliveryService,
    {
      provide: NEURALTALK_DELIVERY_STORE,
      useExisting: NeuralTalkDeliveryService,
    },
    RefreshIntegrationService,
    MetaSystemUserService,
    ExtractContentService,
    OpenaiService,
    DeepgramService,
    ClippingService,
    ClippingRepository,
    FalService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    ThirdPartyRepository,
    ThirdPartyService,
    OAuthRepository,
    OAuthService,
    VideoManager,
    CredentialRepository,
    CredentialService,
    EncryptionService,
    ProfileRepository,
    ProfileService,
    StartupMigrationService,
    VectorInitService,
    KnowledgeRepository,
    KnowledgeService,
    AnnouncementsRepository,
    AnnouncementsService,
    AutomationDeliveryService,
    FlowsRepository,
    FlowsService,
    FlowMessageService,
    UnmatchedCommentService,
    InstagramProvider,
    ReviewLinksRepository,
    ReviewLinksService,
    InstagramMessagingService,
    RepostRepository,
    RepostService,
    StatusService,
    StatusEventService,
    StatusEventRepository,
    InfraHealthService,
    InfraHealthRepository,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
    InstanceCredentialsRepository,
    InstanceCredentialsService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
