-- Caixa lottery results received from the dedicated collector.
-- Results are global and can be reused by every tenant raffle for the same draw.

CREATE TABLE "LotteryResultInbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "modality" TEXT NOT NULL,
  "contestNumber" TEXT NOT NULL,
  "officialDateKey" TEXT NOT NULL,
  "officialDate" TIMESTAMP(3) NOT NULL,
  "prizes" JSONB NOT NULL,
  "firstPrize" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,

  CONSTRAINT "LotteryResultInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LotteryResultInbox_eventId_key"
  ON "LotteryResultInbox"("eventId");

CREATE UNIQUE INDEX "LotteryResultInbox_modality_contestNumber_key"
  ON "LotteryResultInbox"("modality", "contestNumber");

CREATE INDEX "LotteryResultInbox_modality_officialDateKey_idx"
  ON "LotteryResultInbox"("modality", "officialDateKey");

CREATE INDEX "LotteryResultInbox_processedAt_idx"
  ON "LotteryResultInbox"("processedAt");
