-- Additive schema only. Review/backup before the separate production release.
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "originalPath" TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
CREATE TABLE IF NOT EXISTS "PostOperation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "profileId" TEXT,
  "requestHash" TEXT NOT NULL,
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostOperation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PostOperation_organizationId_profileId_idx"
  ON "PostOperation"("organizationId", "profileId");
