-- CreateTable
CREATE TABLE "ProjectRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "title" TEXT,
    "goal" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "hermesLastResponseId" TEXT,
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" JSONB DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "hermesResponseId" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "payload" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prompt" TEXT NOT NULL,
    "context" JSONB DEFAULT '{}',
    "decision" JSONB DEFAULT '{}',
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "projectId" TEXT,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalSeconds" INTEGER,
    "timezone" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "runTemplate" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRun_projectId_createdAt_idx" ON "ProjectRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectRun_status_createdAt_idx" ON "ProjectRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_index_key" ON "RunStep"("runId", "index");

-- CreateIndex
CREATE INDEX "RunStep_runId_status_idx" ON "RunStep"("runId", "status");

-- CreateIndex
CREATE INDEX "RunEvent_runId_createdAt_idx" ON "RunEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "RunEvent_stepId_createdAt_idx" ON "RunEvent"("stepId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_runId_status_idx" ON "ApprovalRequest"("runId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_stepId_status_idx" ON "ApprovalRequest"("stepId", "status");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_createdAt_idx" ON "Notification"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_runId_createdAt_idx" ON "Notification"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Schedule_projectId_enabled_idx" ON "Schedule"("projectId", "enabled");

-- CreateIndex
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProjectRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProjectRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "RunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProjectRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "RunStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProjectRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

