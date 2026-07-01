-- Campos opcionais para taxa de servico da conta de mesa.
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "tableServiceFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "tableServiceFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 10;
