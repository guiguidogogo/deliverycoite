ALTER TABLE "RaffleOrder"
ADD COLUMN "paymentReminderAttemptedAt" TIMESTAMP(3),
ADD COLUMN "paymentReminderSentAt" TIMESTAMP(3),
ADD COLUMN "paymentReminderStatus" TEXT,
ADD COLUMN "paymentReminderError" TEXT;

CREATE INDEX "RaffleOrder_paymentReminderSentAt_paymentStatus_idx"
ON "RaffleOrder"("paymentReminderSentAt", "paymentStatus");
