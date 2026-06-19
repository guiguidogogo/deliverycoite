BEGIN;

CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "cnpj" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "email" TEXT,
    "subdomain" TEXT NOT NULL,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customDomain" TEXT,
    "address" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'basico',
    "mercadoPagoPublicKey" TEXT,
    "mercadoPagoAccessToken" TEXT,
    "menuiaApiKey" TEXT,
    "menuiaStoreId" TEXT,
    "printerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Company_cnpj_key" ON "Company"("cnpj");
CREATE UNIQUE INDEX IF NOT EXISTS "Company_subdomain_key" ON "Company"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "Company_customDomain_key" ON "Company"("customDomain");

INSERT INTO "Company" (
    "id", "companyName", "tradeName", "subdomain", "active", "updatedAt"
) VALUES (
    'default-company', 'Delivery Coité', 'Delivery Coité', 'deliverycoite', true, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
    "companyName" = EXCLUDED."companyName",
    "tradeName" = EXCLUDED."tradeName",
    "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "StaffRole" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Complement" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "ProductComplement" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CustomerAddress" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "PasswordReset" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CouponRedemption" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "OrderItemComplement" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "DeliveryFeeTier" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CashSession" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "CashEntry" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Favorite" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

UPDATE "User" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "StaffRole" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Category" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Product" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Complement" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Customer" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Coupon" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Order" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Setting" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "CashSession" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "Favorite" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;

UPDATE "ProductComplement" pc
SET "companyId" = p."companyId"
FROM "Product" p
WHERE pc."productId" = p."id" AND pc."companyId" IS NULL;

UPDATE "CustomerAddress" ca
SET "companyId" = c."companyId"
FROM "Customer" c
WHERE ca."customerId" = c."id" AND ca."companyId" IS NULL;

UPDATE "PasswordReset" pr
SET "companyId" = u."companyId"
FROM "User" u
WHERE pr."userId" = u."id" AND pr."companyId" IS NULL;

UPDATE "PasswordReset" pr
SET "companyId" = c."companyId"
FROM "Customer" c
WHERE pr."customerId" = c."id" AND pr."companyId" IS NULL;
UPDATE "PasswordReset" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;

UPDATE "CouponRedemption" cr
SET "companyId" = cp."companyId"
FROM "Coupon" cp
WHERE cr."couponId" = cp."id" AND cr."companyId" IS NULL;

UPDATE "OrderItem" oi
SET "companyId" = o."companyId"
FROM "Order" o
WHERE oi."orderId" = o."id" AND oi."companyId" IS NULL;

UPDATE "OrderItemComplement" oic
SET "companyId" = oi."companyId"
FROM "OrderItem" oi
WHERE oic."orderItemId" = oi."id" AND oic."companyId" IS NULL;

UPDATE "DeliveryFeeTier" dft
SET "companyId" = s."companyId"
FROM "Setting" s
WHERE dft."settingId" = s."id" AND dft."companyId" IS NULL;

UPDATE "CashEntry" ce
SET "companyId" = cs."companyId"
FROM "CashSession" cs
WHERE ce."sessionId" = cs."id" AND ce."companyId" IS NULL;

UPDATE "ProductComplement" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "CustomerAddress" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "CouponRedemption" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "OrderItem" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "OrderItemComplement" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "DeliveryFeeTier" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;
UPDATE "CashEntry" SET "companyId" = 'default-company' WHERE "companyId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "StaffRole" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Complement" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ProductComplement" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CustomerAddress" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "PasswordReset" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Coupon" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CouponRedemption" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "OrderItemComplement" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "DeliveryFeeTier" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CashSession" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CashEntry" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Favorite" ALTER COLUMN "companyId" SET NOT NULL;

DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "StaffRole_name_key";
DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Category_slug_key";
DROP INDEX IF EXISTS "Customer_phone_key";
DROP INDEX IF EXISTS "Customer_email_key";
DROP INDEX IF EXISTS "Coupon_code_key";
DROP INDEX IF EXISTS "Setting_companyId_key";
DROP INDEX IF EXISTS "Favorite_phone_productId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "User_companyId_email_key" ON "User"("companyId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_companyId_phone_key" ON "User"("companyId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "StaffRole_companyId_name_key" ON "StaffRole"("companyId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Category_companyId_name_key" ON "Category"("companyId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Category_companyId_slug_key" ON "Category"("companyId", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_companyId_phone_key" ON "Customer"("companyId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_companyId_email_key" ON "Customer"("companyId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_companyId_code_key" ON "Coupon"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "Setting_companyId_key" ON "Setting"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_companyId_phone_productId_key" ON "Favorite"("companyId", "phone", "productId");

CREATE INDEX IF NOT EXISTS "User_companyId_idx" ON "User"("companyId");
CREATE INDEX IF NOT EXISTS "StaffRole_companyId_idx" ON "StaffRole"("companyId");
CREATE INDEX IF NOT EXISTS "Category_companyId_idx" ON "Category"("companyId");
CREATE INDEX IF NOT EXISTS "Product_companyId_idx" ON "Product"("companyId");
CREATE INDEX IF NOT EXISTS "Complement_companyId_idx" ON "Complement"("companyId");
CREATE INDEX IF NOT EXISTS "ProductComplement_companyId_idx" ON "ProductComplement"("companyId");
CREATE INDEX IF NOT EXISTS "Customer_companyId_idx" ON "Customer"("companyId");
CREATE INDEX IF NOT EXISTS "CustomerAddress_companyId_idx" ON "CustomerAddress"("companyId");
CREATE INDEX IF NOT EXISTS "PasswordReset_companyId_idx" ON "PasswordReset"("companyId");
CREATE INDEX IF NOT EXISTS "Coupon_companyId_idx" ON "Coupon"("companyId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_companyId_idx" ON "CouponRedemption"("companyId");
CREATE INDEX IF NOT EXISTS "Order_companyId_idx" ON "Order"("companyId");
CREATE INDEX IF NOT EXISTS "OrderItem_companyId_idx" ON "OrderItem"("companyId");
CREATE INDEX IF NOT EXISTS "OrderItemComplement_companyId_idx" ON "OrderItemComplement"("companyId");
CREATE INDEX IF NOT EXISTS "Setting_companyId_idx" ON "Setting"("companyId");
CREATE INDEX IF NOT EXISTS "DeliveryFeeTier_companyId_idx" ON "DeliveryFeeTier"("companyId");
CREATE INDEX IF NOT EXISTS "CashSession_companyId_idx" ON "CashSession"("companyId");
CREATE INDEX IF NOT EXISTS "CashEntry_companyId_idx" ON "CashEntry"("companyId");
CREATE INDEX IF NOT EXISTS "Favorite_companyId_idx" ON "Favorite"("companyId");

ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Complement" ADD CONSTRAINT "Complement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductComplement" ADD CONSTRAINT "ProductComplement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemComplement" ADD CONSTRAINT "OrderItemComplement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryFeeTier" ADD CONSTRAINT "DeliveryFeeTier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
