-- AlterTable
ALTER TABLE "TicketOrder"
ADD COLUMN IF NOT EXISTS "mercadoPagoPreferenceId" TEXT,
ADD COLUMN IF NOT EXISTS "mercadoPagoPaymentId" TEXT,
ADD COLUMN IF NOT EXISTS "mercadoPagoStatus" TEXT,
ADD COLUMN IF NOT EXISTS "mercadoPagoStatusDetail" TEXT,
ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketOrder_mercadoPagoPreferenceId_idx" ON "TicketOrder"("mercadoPagoPreferenceId");
CREATE INDEX IF NOT EXISTS "TicketOrder_mercadoPagoPaymentId_idx" ON "TicketOrder"("mercadoPagoPaymentId");
