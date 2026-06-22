ALTER TABLE "Company"
ADD COLUMN IF NOT EXISTS "marketplaceVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'Lanches',
ADD COLUMN IF NOT EXISTS "city" TEXT NOT NULL DEFAULT 'Conceição do Coité',
ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS "deliveryTimeMin" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN IF NOT EXISTS "rating" DECIMAL(2,1) NOT NULL DEFAULT 5;

UPDATE "Company" AS company
SET "deliveryFee" = setting."deliveryFee"
FROM "Setting" AS setting
WHERE setting."companyId" = company."id";

CREATE INDEX IF NOT EXISTS "Company_marketplaceVisible_active_idx"
ON "Company"("marketplaceVisible", "active");

CREATE INDEX IF NOT EXISTS "Company_category_city_idx"
ON "Company"("category", "city");
