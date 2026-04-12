ALTER TABLE "Schedule"
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "lockExpiresAt" TIMESTAMP(3),
  ADD COLUMN "config" JSONB DEFAULT '{}';

ALTER TABLE "ProjectRun"
  ADD COLUMN "scheduleId" TEXT;

CREATE INDEX "ProjectRun_scheduleId_createdAt_idx" ON "ProjectRun"("scheduleId", "createdAt");
CREATE INDEX "Schedule_sessionId_enabled_idx" ON "Schedule"("sessionId", "enabled");

ALTER TABLE "ProjectRun" ADD CONSTRAINT "ProjectRun_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

