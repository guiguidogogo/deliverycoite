-- Mesa segura por atendimento: cliente pode solicitar abertura, mas pedidos
-- somente ficam liberados apos confirmacao do PDV/garcom.
ALTER TYPE "TableSessionStatus" ADD VALUE IF NOT EXISTS 'PENDING_CONFIRMATION';

ALTER TABLE "TableSession"
  ADD COLUMN IF NOT EXISTS "customerName" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "customerEmail" TEXT;
