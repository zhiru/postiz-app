-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'APPROVAL', 'CHANGE_REQUEST');

-- CreateEnum
CREATE TYPE "AiScope" AS ENUM ('WORKSPACE', 'PROFILE');

-- CreateEnum
CREATE TYPE "AiKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'WEB_SEARCH');

-- CreateEnum
CREATE TYPE "ProfileRole" AS ENUM ('OWNER', 'MANAGER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FlowNodeType" AS ENUM ('TRIGGER', 'CONDITION', 'REPLY_COMMENT', 'SEND_DM', 'DELAY');

-- CreateEnum
CREATE TYPE "FlowExecutionStatus" AS ENUM ('RUNNING', 'WAITING_POSTBACK', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PendingPostbackStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('MANUAL', 'WEBHOOK_INBOX');

-- CreateEnum
CREATE TYPE "UnmatchedStatus" AS ENUM ('PENDING', 'BOUND', 'IGNORED');

-- CreateEnum
CREATE TYPE "RepostSourceType" AS ENUM ('INSTAGRAM_STORY', 'INSTAGRAM_POST');

-- CreateEnum
CREATE TYPE "RepostDestinationFormat" AS ENUM ('INSTAGRAM_POST', 'INSTAGRAM_STORY', 'FACEBOOK_REEL', 'FACEBOOK_STORY', 'TIKTOK_FEED', 'YOUTUBE_SHORT', 'LINKEDIN_POST', 'X_POST', 'THREADS_POST', 'PINTEREST_PIN');

-- CreateEnum
CREATE TYPE "RepostLogStatus" AS ENUM ('PENDING', 'DOWNLOADED', 'PUBLISHED', 'PARTIAL', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "StatusEventType" AS ENUM ('CHANNEL_DISCONNECT', 'POST_FAILED', 'AUTOMATION_FAILED');

-- CreateEnum
CREATE TYPE "StatusEventSeverity" AS ENUM ('CRITICAL', 'WARNING');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "language" TEXT,
ADD COLUMN     "lateApiKey" TEXT,
ADD COLUMN     "profilesBootstrappedAt" TIMESTAMP(3),
ADD COLUMN     "shareLateWithProfiles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareProviderCredentialsWithProfiles" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shareZernioWithProfiles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zernioApiKey" TEXT;

-- AlterTable
ALTER TABLE "Tags" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Credits" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "profileId" TEXT,
ADD COLUMN     "refreshError" TEXT,
ADD COLUMN     "refreshErrorAt" TIMESTAMP(3),
ADD COLUMN     "tokenEncrypted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Signatures" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Comments" ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestIp" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestUserAgent" TEXT,
ADD COLUMN     "kind" "CommentKind" NOT NULL DEFAULT 'COMMENT',
ADD COLUMN     "reviewLinkId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Notifications" ADD COLUMN     "contentKey" TEXT,
ADD COLUMN     "contentParams" JSONB,
ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Webhooks" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "AutoPost" ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "Sets" ADD COLUMN     "profileId" TEXT;

-- CreateTable
CREATE TABLE "ReviewLink" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "allowComment" BOOLEAN NOT NULL DEFAULT true,
    "allowApprove" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "provider" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "scope" "AiScope" NOT NULL,
    "kind" "AiKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "fallbackModel" TEXT,
    "options" JSONB,
    "encryptedData" TEXT NOT NULL,
    "shareDefault" BOOLEAN NOT NULL DEFAULT true,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "organizationId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lateApiKey" TEXT,
    "zernioApiKey" TEXT,
    "apiKey" TEXT,
    "shortlink" "ShortLinkPreference" NOT NULL DEFAULT 'ASK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "aiImageCredits" INTEGER,
    "aiVideoCredits" INTEGER,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileKnowledgeDocument" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileKnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePersona" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "brandDescription" TEXT,
    "toneOfVoice" TEXT,
    "writingInstructions" TEXT,
    "preferredCtas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentRestrictions" TEXT,
    "imageStyle" TEXT,
    "targetAudience" TEXT,
    "examplePosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileMember" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProfileRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerPostIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowNode" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "type" "FlowNodeType" NOT NULL,
    "label" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowEdge" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowExecution" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "temporalWorkflowId" TEXT,
    "triggerType" TEXT,
    "igCommentId" TEXT,
    "igCommenterId" TEXT NOT NULL,
    "igCommenterName" TEXT,
    "igMediaId" TEXT NOT NULL,
    "igThreadId" TEXT,
    "igMessageId" TEXT,
    "commentText" TEXT NOT NULL,
    "status" "FlowExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "error" TEXT,
    "executionLog" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingPostback" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadHmac" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "originExecutionId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "igSenderId" TEXT NOT NULL,
    "igCommenterName" TEXT,
    "igMediaId" TEXT,
    "igCommentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "consumedMetaMid" TEXT,
    "status" "PendingPostbackStatus" NOT NULL DEFAULT 'PENDING',
    "snapshotFinalDm" TEXT,
    "snapshotFinalBtnText" TEXT,
    "snapshotFinalBtnUrl" TEXT,
    "snapshotGateDm" TEXT,
    "snapshotAlreadyBtnText" TEXT,
    "snapshotExhaustedMessage" TEXT,
    "openingDmMessage" TEXT,
    "openingDmButtonText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PendingPostback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowMediaAlias" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "aliasMediaId" TEXT NOT NULL,
    "source" "AliasSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "boundBy" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowMediaAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmatchedComment" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "igCommentId" TEXT NOT NULL,
    "igCommenterId" TEXT NOT NULL,
    "igCommenterName" TEXT,
    "commentText" TEXT NOT NULL,
    "status" "UnmatchedStatus" NOT NULL DEFAULT 'PENDING',
    "permalink" TEXT,
    "caption" TEXT,
    "thumbnailUrl" TEXT,
    "mediaType" TEXT,
    "isAd" BOOLEAN,
    "enrichedAt" TIMESTAMP(3),
    "enrichmentError" TEXT,
    "boundFlowId" TEXT,
    "boundAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgnoredMedia" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "reason" TEXT,
    "ignoredBy" TEXT,
    "ignoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepostRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceIntegrationId" TEXT NOT NULL,
    "sourceType" "RepostSourceType" NOT NULL DEFAULT 'INSTAGRAM_STORY',
    "destinationIntegrationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "filterIncludeVideos" BOOLEAN NOT NULL DEFAULT true,
    "filterIncludeImages" BOOLEAN NOT NULL DEFAULT false,
    "filterMaxDurationSeconds" INTEGER,
    "filterHashtag" TEXT,
    "captionTemplate" TEXT,
    "lastSourceItemId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RepostRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepostRuleDestination" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "format" "RepostDestinationFormat" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepostRuleDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepostLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "mediaUrlOriginal" TEXT NOT NULL,
    "storedMediaId" TEXT,
    "status" "RepostLogStatus" NOT NULL DEFAULT 'PENDING',
    "skippedReason" TEXT,
    "errorMessage" TEXT,
    "publishedPosts" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RepostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "integrationId" TEXT,
    "type" "StatusEventType" NOT NULL,
    "severity" "StatusEventSeverity" NOT NULL,
    "message" TEXT,
    "channelName" TEXT,
    "channelPicture" TEXT,
    "providerIdentifier" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationDelivery" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewLink_tokenHash_key" ON "ReviewLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ReviewLink_postId_idx" ON "ReviewLink"("postId");

-- CreateIndex
CREATE INDEX "ReviewLink_organizationId_idx" ON "ReviewLink"("organizationId");

-- CreateIndex
CREATE INDEX "ReviewLink_revokedAt_idx" ON "ReviewLink"("revokedAt");

-- CreateIndex
CREATE INDEX "ReviewLink_expiresAt_idx" ON "ReviewLink"("expiresAt");

-- CreateIndex
CREATE INDEX "ProviderCredential_organizationId_idx" ON "ProviderCredential"("organizationId");

-- CreateIndex
CREATE INDEX "ProviderCredential_profileId_idx" ON "ProviderCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_organizationId_profileId_provider_key" ON "ProviderCredential"("organizationId", "profileId", "provider");

-- CreateIndex
CREATE INDEX "AiProviderCredential_organizationId_kind_idx" ON "AiProviderCredential"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "AiProviderCredential_profileId_idx" ON "AiProviderCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_organizationId_profileId_scope_kind_key" ON "AiProviderCredential"("organizationId", "profileId", "scope", "kind");

-- CreateIndex
CREATE INDEX "Profile_organizationId_idx" ON "Profile"("organizationId");

-- CreateIndex
CREATE INDEX "Profile_isDefault_idx" ON "Profile"("isDefault");

-- CreateIndex
CREATE INDEX "Profile_apiKey_idx" ON "Profile"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_organizationId_slug_deletedAt_key" ON "Profile"("organizationId", "slug", "deletedAt");

-- CreateIndex
CREATE INDEX "ProfileKnowledgeDocument_profileId_idx" ON "ProfileKnowledgeDocument"("profileId");

-- CreateIndex
CREATE INDEX "ProfileKnowledgeDocument_status_idx" ON "ProfileKnowledgeDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePersona_profileId_key" ON "ProfilePersona"("profileId");

-- CreateIndex
CREATE INDEX "ProfilePersona_profileId_idx" ON "ProfilePersona"("profileId");

-- CreateIndex
CREATE INDEX "ProfileMember_userId_idx" ON "ProfileMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileMember_profileId_userId_key" ON "ProfileMember"("profileId", "userId");

-- CreateIndex
CREATE INDEX "Flow_organizationId_idx" ON "Flow"("organizationId");

-- CreateIndex
CREATE INDEX "Flow_profileId_idx" ON "Flow"("profileId");

-- CreateIndex
CREATE INDEX "Flow_integrationId_idx" ON "Flow"("integrationId");

-- CreateIndex
CREATE INDEX "Flow_status_idx" ON "Flow"("status");

-- CreateIndex
CREATE INDEX "Flow_deletedAt_idx" ON "Flow"("deletedAt");

-- CreateIndex
CREATE INDEX "FlowNode_flowId_idx" ON "FlowNode"("flowId");

-- CreateIndex
CREATE INDEX "FlowNode_type_idx" ON "FlowNode"("type");

-- CreateIndex
CREATE INDEX "FlowEdge_flowId_idx" ON "FlowEdge"("flowId");

-- CreateIndex
CREATE INDEX "FlowEdge_sourceNodeId_idx" ON "FlowEdge"("sourceNodeId");

-- CreateIndex
CREATE INDEX "FlowEdge_targetNodeId_idx" ON "FlowEdge"("targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowEdge_flowId_sourceNodeId_targetNodeId_sourceHandle_key" ON "FlowEdge"("flowId", "sourceNodeId", "targetNodeId", "sourceHandle");

-- CreateIndex
CREATE INDEX "FlowExecution_flowId_idx" ON "FlowExecution"("flowId");

-- CreateIndex
CREATE INDEX "FlowExecution_status_idx" ON "FlowExecution"("status");

-- CreateIndex
CREATE INDEX "FlowExecution_igCommenterId_idx" ON "FlowExecution"("igCommenterId");

-- CreateIndex
CREATE INDEX "FlowExecution_igMediaId_idx" ON "FlowExecution"("igMediaId");

-- CreateIndex
CREATE INDEX "FlowExecution_igMessageId_idx" ON "FlowExecution"("igMessageId");

-- CreateIndex
CREATE INDEX "FlowExecution_triggerType_idx" ON "FlowExecution"("triggerType");

-- CreateIndex
CREATE INDEX "FlowExecution_createdAt_idx" ON "FlowExecution"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowExecution_flowId_igCommentId_key" ON "FlowExecution"("flowId", "igCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowExecution_flowId_igMessageId_key" ON "FlowExecution"("flowId", "igMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingPostback_payload_key" ON "PendingPostback"("payload");

-- CreateIndex
CREATE UNIQUE INDEX "PendingPostback_consumedMetaMid_key" ON "PendingPostback"("consumedMetaMid");

-- CreateIndex
CREATE INDEX "PendingPostback_flowId_idx" ON "PendingPostback"("flowId");

-- CreateIndex
CREATE INDEX "PendingPostback_originExecutionId_idx" ON "PendingPostback"("originExecutionId");

-- CreateIndex
CREATE INDEX "PendingPostback_expiresAt_idx" ON "PendingPostback"("expiresAt");

-- CreateIndex
CREATE INDEX "PendingPostback_status_idx" ON "PendingPostback"("status");

-- CreateIndex
CREATE INDEX "PendingPostback_igSenderId_idx" ON "PendingPostback"("igSenderId");

-- CreateIndex
CREATE INDEX "FlowMediaAlias_integrationId_aliasMediaId_idx" ON "FlowMediaAlias"("integrationId", "aliasMediaId");

-- CreateIndex
CREATE INDEX "FlowMediaAlias_flowId_idx" ON "FlowMediaAlias"("flowId");

-- CreateIndex
CREATE INDEX "FlowMediaAlias_aliasMediaId_idx" ON "FlowMediaAlias"("aliasMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowMediaAlias_flowId_aliasMediaId_key" ON "FlowMediaAlias"("flowId", "aliasMediaId");

-- CreateIndex
CREATE INDEX "UnmatchedComment_integrationId_status_createdAt_idx" ON "UnmatchedComment"("integrationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "UnmatchedComment_organizationId_idx" ON "UnmatchedComment"("organizationId");

-- CreateIndex
CREATE INDEX "UnmatchedComment_igMediaId_idx" ON "UnmatchedComment"("igMediaId");

-- CreateIndex
CREATE INDEX "UnmatchedComment_createdAt_idx" ON "UnmatchedComment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedComment_integrationId_igCommentId_key" ON "UnmatchedComment"("integrationId", "igCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredMedia_integrationId_igMediaId_key" ON "IgnoredMedia"("integrationId", "igMediaId");

-- CreateIndex
CREATE INDEX "RepostRule_organizationId_profileId_idx" ON "RepostRule"("organizationId", "profileId");

-- CreateIndex
CREATE INDEX "RepostRule_sourceIntegrationId_idx" ON "RepostRule"("sourceIntegrationId");

-- CreateIndex
CREATE INDEX "RepostRule_enabled_idx" ON "RepostRule"("enabled");

-- CreateIndex
CREATE INDEX "RepostRule_deletedAt_idx" ON "RepostRule"("deletedAt");

-- CreateIndex
CREATE INDEX "RepostRuleDestination_ruleId_idx" ON "RepostRuleDestination"("ruleId");

-- CreateIndex
CREATE INDEX "RepostRuleDestination_integrationId_idx" ON "RepostRuleDestination"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "RepostRuleDestination_ruleId_integrationId_format_key" ON "RepostRuleDestination"("ruleId", "integrationId", "format");

-- CreateIndex
CREATE INDEX "RepostLog_ruleId_status_idx" ON "RepostLog"("ruleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepostLog_ruleId_sourceItemId_key" ON "RepostLog"("ruleId", "sourceItemId");

-- CreateIndex
CREATE INDEX "StatusEvent_organizationId_createdAt_idx" ON "StatusEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusEvent_organizationId_type_idx" ON "StatusEvent"("organizationId", "type");

-- CreateIndex
CREATE INDEX "StatusEvent_organizationId_profileId_idx" ON "StatusEvent"("organizationId", "profileId");

-- CreateIndex
CREATE INDEX "StatusEvent_createdAt_idx" ON "StatusEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDelivery_key_key" ON "AutomationDelivery"("key");

-- CreateIndex
CREATE INDEX "Tags_profileId_idx" ON "Tags"("profileId");

-- CreateIndex
CREATE INDEX "Media_profileId_idx" ON "Media"("profileId");

-- CreateIndex
CREATE INDEX "Credits_profileId_idx" ON "Credits"("profileId");

-- CreateIndex
CREATE INDEX "Integration_profileId_idx" ON "Integration"("profileId");

-- CreateIndex
CREATE INDEX "Signatures_profileId_idx" ON "Signatures"("profileId");

-- CreateIndex
CREATE INDEX "Comments_reviewLinkId_idx" ON "Comments"("reviewLinkId");

-- CreateIndex
CREATE INDEX "Comments_kind_idx" ON "Comments"("kind");

-- CreateIndex
CREATE INDEX "Post_profileId_idx" ON "Post"("profileId");

-- CreateIndex
CREATE INDEX "Notifications_profileId_idx" ON "Notifications"("profileId");

-- CreateIndex
CREATE INDEX "Webhooks_profileId_idx" ON "Webhooks"("profileId");

-- CreateIndex
CREATE INDEX "AutoPost_profileId_idx" ON "AutoPost"("profileId");

-- CreateIndex
CREATE INDEX "Sets_profileId_idx" ON "Sets"("profileId");

-- AddForeignKey
ALTER TABLE "Tags" ADD CONSTRAINT "Tags_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credits" ADD CONSTRAINT "Credits_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatures" ADD CONSTRAINT "Signatures_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_reviewLinkId_fkey" FOREIGN KEY ("reviewLinkId") REFERENCES "ReviewLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhooks" ADD CONSTRAINT "Webhooks_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPost" ADD CONSTRAINT "AutoPost_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sets" ADD CONSTRAINT "Sets_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileKnowledgeDocument" ADD CONSTRAINT "ProfileKnowledgeDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePersona" ADD CONSTRAINT "ProfilePersona_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileMember" ADD CONSTRAINT "ProfileMember_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileMember" ADD CONSTRAINT "ProfileMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowNode" ADD CONSTRAINT "FlowNode_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEdge" ADD CONSTRAINT "FlowEdge_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEdge" ADD CONSTRAINT "FlowEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "FlowNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEdge" ADD CONSTRAINT "FlowEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "FlowNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowExecution" ADD CONSTRAINT "FlowExecution_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingPostback" ADD CONSTRAINT "PendingPostback_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingPostback" ADD CONSTRAINT "PendingPostback_originExecutionId_fkey" FOREIGN KEY ("originExecutionId") REFERENCES "FlowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMediaAlias" ADD CONSTRAINT "FlowMediaAlias_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMediaAlias" ADD CONSTRAINT "FlowMediaAlias_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMediaAlias" ADD CONSTRAINT "FlowMediaAlias_boundBy_fkey" FOREIGN KEY ("boundBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedComment" ADD CONSTRAINT "UnmatchedComment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedComment" ADD CONSTRAINT "UnmatchedComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedComment" ADD CONSTRAINT "UnmatchedComment_boundFlowId_fkey" FOREIGN KEY ("boundFlowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredMedia" ADD CONSTRAINT "IgnoredMedia_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredMedia" ADD CONSTRAINT "IgnoredMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredMedia" ADD CONSTRAINT "IgnoredMedia_ignoredBy_fkey" FOREIGN KEY ("ignoredBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostRule" ADD CONSTRAINT "RepostRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostRule" ADD CONSTRAINT "RepostRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostRule" ADD CONSTRAINT "RepostRule_sourceIntegrationId_fkey" FOREIGN KEY ("sourceIntegrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostRuleDestination" ADD CONSTRAINT "RepostRuleDestination_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RepostRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostRuleDestination" ADD CONSTRAINT "RepostRuleDestination_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepostLog" ADD CONSTRAINT "RepostLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RepostRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
