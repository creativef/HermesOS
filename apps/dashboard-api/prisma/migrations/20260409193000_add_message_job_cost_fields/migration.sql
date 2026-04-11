ALTER TABLE "MessageJob"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "promptTokens" INTEGER,
  ADD COLUMN "completionTokens" INTEGER,
  ADD COLUMN "totalTokens" INTEGER,
  ADD COLUMN "estimatedUsd" DOUBLE PRECISION,
  ADD COLUMN "durationMs" INTEGER;

