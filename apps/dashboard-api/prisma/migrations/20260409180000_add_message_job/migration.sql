-- CreateTable
CREATE TABLE "MessageJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageJob_projectId_sessionId_createdAt_idx" ON "MessageJob"("projectId", "sessionId", "createdAt");

