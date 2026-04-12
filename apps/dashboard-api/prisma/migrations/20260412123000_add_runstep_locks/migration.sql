ALTER TABLE "RunStep"
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "lockExpiresAt" TIMESTAMP(3);

CREATE INDEX "RunStep_status_lockExpiresAt_idx" ON "RunStep"("status", "lockExpiresAt");

