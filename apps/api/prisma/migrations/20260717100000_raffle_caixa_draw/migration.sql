-- Apuracao automatica de rifas por resultados oficiais das Loterias CAIXA.
-- Modo manual permanece como padrao para preservar rifas existentes.

CREATE TYPE "RaffleDrawMode" AS ENUM ('MANUAL', 'AUTOMATIC_CAIXA');

CREATE TYPE "RaffleDrawStatus" AS ENUM (
  'MANUAL',
  'SCHEDULED',
  'WAITING_CONTEST',
  'WAITING_RESULT',
  'PROCESSING',
  'CONFIRMED',
  'NO_VALID_PARTICIPANT',
  'ERROR'
);

ALTER TABLE "Raffle"
  ADD COLUMN "drawMode" "RaffleDrawMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "drawLotteryModality" TEXT,
  ADD COLUMN "drawContestNumber" TEXT,
  ADD COLUMN "drawScheduledAt" TIMESTAMP(3),
  ADD COLUMN "drawStatus" "RaffleDrawStatus" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "drawLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "drawAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "drawLastError" TEXT,
  ADD COLUMN "drawBaseNumber" TEXT,
  ADD COLUMN "drawDigits" INTEGER,
  ADD COLUMN "drawWinningNumber" TEXT,
  ADD COLUMN "drawOfficialDate" TIMESTAMP(3),
  ADD COLUMN "drawConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "drawRawResponse" JSONB,
  ADD COLUMN "drawWinnerParticipantId" TEXT,
  ADD COLUMN "drawWinnerOrderId" TEXT,
  ADD COLUMN "drawWinnerNumberId" TEXT;

CREATE INDEX "Raffle_companyId_drawMode_drawStatus_drawScheduledAt_idx"
  ON "Raffle"("companyId", "drawMode", "drawStatus", "drawScheduledAt");
