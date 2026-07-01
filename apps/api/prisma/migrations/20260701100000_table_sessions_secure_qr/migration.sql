-- Sessao segura por atendimento de mesa.
-- Migration aditiva: nao remove dados existentes.

ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'TABLE_QR';

DO $$ BEGIN
  CREATE TYPE "TableSessionStatus" AS ENUM ('OPEN', 'CLOSING_REQUESTED', 'CLOSED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "TableSession" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "status" "TableSessionStatus" NOT NULL DEFAULT 'OPEN',
  "token" TEXT NOT NULL,
  "shortCode" TEXT NOT NULL,
  "openedByUserId" TEXT,
  "closedByUserId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TableSession_token_key" ON "TableSession"("token");
CREATE INDEX IF NOT EXISTS "TableSession_companyId_status_idx" ON "TableSession"("companyId", "status");
CREATE INDEX IF NOT EXISTS "TableSession_companyId_tableId_openedAt_idx" ON "TableSession"("companyId", "tableId", "openedAt");
CREATE INDEX IF NOT EXISTS "TableSession_token_idx" ON "TableSession"("token");

ALTER TABLE "TableSession"
  ADD CONSTRAINT "TableSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession"
  ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession"
  ADD CONSTRAINT "TableSession_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TableSession"
  ADD CONSTRAINT "TableSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tableSessionId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_companyId_tableSessionId_idx" ON "Order"("companyId", "tableSessionId");
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
