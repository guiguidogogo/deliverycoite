ALTER TABLE "Company" ADD COLUMN "printerAgentTokenHash" TEXT;
ALTER TABLE "Company" ADD COLUMN "printerAgentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "printerAgentLastSeenAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN "printerQueuedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "printerPrintedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "printerPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "printerLastError" TEXT;

CREATE INDEX "Order_companyId_printerPrintedAt_idx" ON "Order"("companyId", "printerPrintedAt");
