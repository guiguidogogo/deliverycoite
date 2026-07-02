ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "trackStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stockQuantity" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lowStockAlert" DECIMAL(10, 3);

ALTER TABLE "Complement"
  ADD COLUMN IF NOT EXISTS "trackStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stockQuantity" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lowStockAlert" DECIMAL(10, 3);

CREATE INDEX IF NOT EXISTS "Product_companyId_trackStock_idx" ON "Product"("companyId", "trackStock");
CREATE INDEX IF NOT EXISTS "Complement_companyId_trackStock_idx" ON "Complement"("companyId", "trackStock");
