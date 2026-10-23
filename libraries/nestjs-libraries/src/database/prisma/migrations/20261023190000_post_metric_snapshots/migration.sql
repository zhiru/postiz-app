-- AlterTable
ALTER TABLE "Notifications" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "PostMetricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "integrationId" TEXT NOT NULL,
    "postId" TEXT,
    "remoteId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "capturedHour" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'unknown',
    "metrics" JSONB NOT NULL,
    "retryAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_organizationId_profileId_capturedAt_idx" ON "PostMetricSnapshot"("organizationId", "profileId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_postId_capturedAt_idx" ON "PostMetricSnapshot"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_integrationId_remoteId_idx" ON "PostMetricSnapshot"("integrationId", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PostMetricSnapshot_scopeKey_integrationId_remoteId_captured_key" ON "PostMetricSnapshot"("scopeKey", "integrationId", "remoteId", "capturedHour", "source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Notifications_dedupeKey_key" ON "Notifications"("dedupeKey");

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

