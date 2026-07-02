CREATE TABLE "PrinterJob" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "referenceId" TEXT,
  "referenceLabel" TEXT,
  "receipt" TEXT NOT NULL,
  "copies" INTEGER NOT NULL DEFAULT 1,
  "queuedAt" TIMESTAMP(3),
  "printedAt" TIMESTAMP(3),
  "printCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrinterJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrinterJob_companyId_printedAt_queuedAt_idx" ON "PrinterJob"("companyId", "printedAt", "queuedAt");
CREATE INDEX "PrinterJob_companyId_type_createdAt_idx" ON "PrinterJob"("companyId", "type", "createdAt");
CREATE INDEX "PrinterJob_referenceId_idx" ON "PrinterJob"("referenceId");

ALTER TABLE "PrinterJob"
  ADD CONSTRAINT "PrinterJob_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
