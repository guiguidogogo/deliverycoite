CREATE TYPE "OrderSource" AS ENUM ('DELIVERY', 'TABLE', 'COUNTER', 'WAITER');
CREATE TYPE "TableStatus" AS ENUM ('FREE', 'OCCUPIED', 'WAITING_PAYMENT', 'RESERVED', 'CLEANING');

CREATE TABLE "DiningArea" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiningArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RestaurantTable" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "areaId" TEXT,
  "number" INTEGER NOT NULL,
  "name" TEXT,
  "seats" INTEGER NOT NULL DEFAULT 4,
  "status" "TableStatus" NOT NULL DEFAULT 'FREE',
  "qrCodeToken" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "openedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "tableId" TEXT,
  ADD COLUMN "waiterId" TEXT;

CREATE UNIQUE INDEX "DiningArea_companyId_name_key" ON "DiningArea"("companyId", "name");
CREATE INDEX "DiningArea_companyId_idx" ON "DiningArea"("companyId");

CREATE UNIQUE INDEX "RestaurantTable_qrCodeToken_key" ON "RestaurantTable"("qrCodeToken");
CREATE UNIQUE INDEX "RestaurantTable_companyId_number_key" ON "RestaurantTable"("companyId", "number");
CREATE INDEX "RestaurantTable_companyId_status_idx" ON "RestaurantTable"("companyId", "status");
CREATE INDEX "RestaurantTable_companyId_areaId_idx" ON "RestaurantTable"("companyId", "areaId");

CREATE INDEX "Order_companyId_source_idx" ON "Order"("companyId", "source");
CREATE INDEX "Order_companyId_tableId_idx" ON "Order"("companyId", "tableId");

ALTER TABLE "DiningArea"
  ADD CONSTRAINT "DiningArea_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantTable"
  ADD CONSTRAINT "RestaurantTable_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantTable"
  ADD CONSTRAINT "RestaurantTable_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "DiningArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_waiterId_fkey"
  FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
