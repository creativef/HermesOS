ALTER TABLE "RunStep"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "promptTokens" INTEGER,
  ADD COLUMN "completionTokens" INTEGER,
  ADD COLUMN "totalTokens" INTEGER,
  ADD COLUMN "estimatedUsd" DOUBLE PRECISION;

