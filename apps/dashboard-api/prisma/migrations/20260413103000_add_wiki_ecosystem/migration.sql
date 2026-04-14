CREATE TABLE "WikiProject" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WikiSource" (
  "id" TEXT NOT NULL,
  "wikiProjectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT,
  "url" TEXT,
  "path" TEXT,
  "content" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WikiBuild" (
  "id" TEXT NOT NULL,
  "wikiProjectId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "title" TEXT,
  "goal" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "hermesLastResponseId" TEXT,
  "lockedBy" TEXT,
  "lockExpiresAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiBuild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WikiBuildStep" (
  "id" TEXT NOT NULL,
  "buildId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedBy" TEXT,
  "lockExpiresAt" TIMESTAMP(3),
  "input" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "output" JSONB,
  "error" TEXT,
  "hermesResponseId" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedUsd" DOUBLE PRECISION,
  "durationMs" INTEGER,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiBuildStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WikiEvent" (
  "id" TEXT NOT NULL,
  "wikiProjectId" TEXT NOT NULL,
  "buildId" TEXT,
  "stepId" TEXT,
  "level" TEXT NOT NULL DEFAULT 'info',
  "message" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WikiEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WikiSource" ADD CONSTRAINT "WikiSource_wikiProjectId_fkey"
  FOREIGN KEY ("wikiProjectId") REFERENCES "WikiProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiBuild" ADD CONSTRAINT "WikiBuild_wikiProjectId_fkey"
  FOREIGN KEY ("wikiProjectId") REFERENCES "WikiProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiBuildStep" ADD CONSTRAINT "WikiBuildStep_buildId_fkey"
  FOREIGN KEY ("buildId") REFERENCES "WikiBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiEvent" ADD CONSTRAINT "WikiEvent_wikiProjectId_fkey"
  FOREIGN KEY ("wikiProjectId") REFERENCES "WikiProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiEvent" ADD CONSTRAINT "WikiEvent_buildId_fkey"
  FOREIGN KEY ("buildId") REFERENCES "WikiBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WikiEvent" ADD CONSTRAINT "WikiEvent_stepId_fkey"
  FOREIGN KEY ("stepId") REFERENCES "WikiBuildStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WikiProject_status_createdAt_idx" ON "WikiProject"("status", "createdAt");

CREATE INDEX "WikiSource_wikiProjectId_createdAt_idx" ON "WikiSource"("wikiProjectId", "createdAt");

CREATE INDEX "WikiBuild_wikiProjectId_createdAt_idx" ON "WikiBuild"("wikiProjectId", "createdAt");
CREATE INDEX "WikiBuild_status_createdAt_idx" ON "WikiBuild"("status", "createdAt");

CREATE UNIQUE INDEX "WikiBuildStep_buildId_index_key" ON "WikiBuildStep"("buildId", "index");
CREATE INDEX "WikiBuildStep_buildId_status_idx" ON "WikiBuildStep"("buildId", "status");
CREATE INDEX "WikiBuildStep_status_lockExpiresAt_idx" ON "WikiBuildStep"("status", "lockExpiresAt");

CREATE INDEX "WikiEvent_wikiProjectId_createdAt_idx" ON "WikiEvent"("wikiProjectId", "createdAt");
CREATE INDEX "WikiEvent_buildId_createdAt_idx" ON "WikiEvent"("buildId", "createdAt");
CREATE INDEX "WikiEvent_stepId_createdAt_idx" ON "WikiEvent"("stepId", "createdAt");

