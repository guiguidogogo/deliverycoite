-- Cadastro global de clientes e vinculo Cliente x Empresa.
-- Migration segura: adiciona estruturas novas e faz backfill sem remover dados antigos.

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "globalCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "companyCustomerId" TEXT;

CREATE TABLE IF NOT EXISTS "GlobalCustomer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT NOT NULL,
  "whatsapp" TEXT,
  "passwordHash" TEXT,
  "lastAccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CompanyCustomer" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "globalCustomerId" TEXT NOT NULL,
  "firstPurchaseAt" TIMESTAMP(3),
  "lastPurchaseAt" TIMESTAMP(3),
  "ordersCount" INTEGER NOT NULL DEFAULT 0,
  "totalSpent" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "averageTicket" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "preferences" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyCustomer_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GlobalCustomer" ("id", "name", "email", "phone", "whatsapp", "passwordHash", "lastAccessAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (regexp_replace(c."phone", '\\D', '', 'g'))
  'gc_' || md5(regexp_replace(c."phone", '\\D', '', 'g')),
  c."name",
  NULL,
  regexp_replace(c."phone", '\\D', '', 'g'),
  regexp_replace(c."phone", '\\D', '', 'g'),
  c."passwordHash",
  c."updatedAt",
  c."createdAt",
  CURRENT_TIMESTAMP
FROM "Customer" c
WHERE c."phone" IS NOT NULL
  AND regexp_replace(c."phone", '\\D', '', 'g') <> ''
ORDER BY regexp_replace(c."phone", '\\D', '', 'g'), c."updatedAt" DESC
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CompanyCustomer" ("id", "companyId", "globalCustomerId", "firstPurchaseAt", "lastPurchaseAt", "ordersCount", "totalSpent", "averageTicket", "active", "createdAt", "updatedAt")
SELECT
  'cc_' || md5(c."companyId" || ':' || gc."id"),
  c."companyId",
  gc."id",
  MIN(o."createdAt"),
  MAX(o."createdAt"),
  COUNT(o."id")::int,
  COALESCE(SUM(o."total"), 0),
  CASE WHEN COUNT(o."id") > 0 THEN COALESCE(SUM(o."total"), 0) / COUNT(o."id") ELSE 0 END,
  true,
  MIN(c."createdAt"),
  CURRENT_TIMESTAMP
FROM "Customer" c
JOIN "GlobalCustomer" gc ON gc."phone" = regexp_replace(c."phone", '\\D', '', 'g')
LEFT JOIN "Order" o ON o."customerId" = c."id" AND o."companyId" = c."companyId" AND o."deletedAt" IS NULL
GROUP BY c."companyId", gc."id"
ON CONFLICT ("id") DO NOTHING;

UPDATE "Customer" c
SET
  "globalCustomerId" = gc."id",
  "companyCustomerId" = cc."id"
FROM "GlobalCustomer" gc
JOIN "CompanyCustomer" cc ON cc."globalCustomerId" = gc."id"
WHERE gc."phone" = regexp_replace(c."phone", '\\D', '', 'g')
  AND cc."companyId" = c."companyId"
  AND (c."globalCustomerId" IS NULL OR c."companyCustomerId" IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalCustomer_email_key" ON "GlobalCustomer"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "GlobalCustomer_phone_key" ON "GlobalCustomer"("phone");
CREATE INDEX IF NOT EXISTS "GlobalCustomer_phone_idx" ON "GlobalCustomer"("phone");
CREATE INDEX IF NOT EXISTS "GlobalCustomer_email_idx" ON "GlobalCustomer"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyCustomer_companyId_globalCustomerId_key" ON "CompanyCustomer"("companyId", "globalCustomerId");
CREATE INDEX IF NOT EXISTS "CompanyCustomer_companyId_active_idx" ON "CompanyCustomer"("companyId", "active");
CREATE INDEX IF NOT EXISTS "CompanyCustomer_companyId_lastPurchaseAt_idx" ON "CompanyCustomer"("companyId", "lastPurchaseAt");
CREATE INDEX IF NOT EXISTS "CompanyCustomer_globalCustomerId_idx" ON "CompanyCustomer"("globalCustomerId");
CREATE INDEX IF NOT EXISTS "Customer_globalCustomerId_idx" ON "Customer"("globalCustomerId");
CREATE INDEX IF NOT EXISTS "Customer_companyCustomerId_idx" ON "Customer"("companyCustomerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyCustomer_companyId_fkey') THEN
    ALTER TABLE "CompanyCustomer" ADD CONSTRAINT "CompanyCustomer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyCustomer_globalCustomerId_fkey') THEN
    ALTER TABLE "CompanyCustomer" ADD CONSTRAINT "CompanyCustomer_globalCustomerId_fkey" FOREIGN KEY ("globalCustomerId") REFERENCES "GlobalCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_globalCustomerId_fkey') THEN
    ALTER TABLE "Customer" ADD CONSTRAINT "Customer_globalCustomerId_fkey" FOREIGN KEY ("globalCustomerId") REFERENCES "GlobalCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_companyCustomerId_fkey') THEN
    ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyCustomerId_fkey" FOREIGN KEY ("companyCustomerId") REFERENCES "CompanyCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
