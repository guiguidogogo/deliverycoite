ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "mercadoPagoPreferenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "mercadoPagoPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "mercadoPagoStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "mercadoPagoStatusDetail" TEXT;

CREATE INDEX IF NOT EXISTS "Order_mercadoPagoPreferenceId_idx" ON "Order"("mercadoPagoPreferenceId");
CREATE INDEX IF NOT EXISTS "Order_mercadoPagoPaymentId_idx" ON "Order"("mercadoPagoPaymentId");
