ALTER TABLE "CashSession"
ADD COLUMN IF NOT EXISTS "operatorName" TEXT,
ADD COLUMN IF NOT EXISTS "openingIp" TEXT,
ADD COLUMN IF NOT EXISTS "openingDevice" TEXT,
ADD COLUMN IF NOT EXISTS "expectedAmount" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "difference" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "closingNotes" TEXT,
ADD COLUMN IF NOT EXISTS "closedBy" TEXT,
ADD COLUMN IF NOT EXISTS "closingIp" TEXT,
ADD COLUMN IF NOT EXISTS "closingDevice" TEXT,
ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reopenedBy" TEXT,
ADD COLUMN IF NOT EXISTS "reopenReason" TEXT,
ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "CashEntry"
ADD COLUMN IF NOT EXISTS "category" TEXT,
ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'IN',
ADD COLUMN IF NOT EXISTS "paymentDetail" TEXT,
ADD COLUMN IF NOT EXISTS "operatorId" TEXT,
ADD COLUMN IF NOT EXISTS "operatorName" TEXT,
ADD COLUMN IF NOT EXISTS "reason" TEXT,
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;

ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;

ALTER TABLE "Customer"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;

UPDATE "CashEntry" SET "direction" = 'OUT'
WHERE "type" IN ('WITHDRAWAL', 'EXPENSE', 'CLOSING');

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "ipAddress" TEXT,
  "device" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AccountPayable" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountPayable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountPayable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AccountReceivable" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "receivedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountReceivable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountReceivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CashSession_companyId_openedBy_closedAt_idx" ON "CashSession"("companyId", "openedBy", "closedAt");
CREATE INDEX IF NOT EXISTS "CashEntry_companyId_createdAt_direction_idx" ON "CashEntry"("companyId", "createdAt", "direction");
CREATE INDEX IF NOT EXISTS "Order_companyId_deletedAt_idx" ON "Order"("companyId", "deletedAt");
CREATE INDEX IF NOT EXISTS "Customer_companyId_deletedAt_idx" ON "Customer"("companyId", "deletedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_entity_entityId_idx" ON "AuditLog"("companyId", "entity", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_userId_idx" ON "AuditLog"("companyId", "userId");
CREATE INDEX IF NOT EXISTS "AccountPayable_companyId_dueDate_status_idx" ON "AccountPayable"("companyId", "dueDate", "status");
CREATE INDEX IF NOT EXISTS "AccountReceivable_companyId_dueDate_status_idx" ON "AccountReceivable"("companyId", "dueDate", "status");
