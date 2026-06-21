CREATE TYPE "DeliveryRouteStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

CREATE TABLE "Driver" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "whatsapp" TEXT NOT NULL,
  "vehicle" TEXT NOT NULL,
  "licensePlate" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryRoute" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'CREATED',
  "googleMapsUrl" TEXT NOT NULL,
  "whatsappMessage" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryRouteOrder" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryRouteOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Driver_companyId_phone_key" ON "Driver"("companyId", "phone");
CREATE INDEX "Driver_companyId_active_idx" ON "Driver"("companyId", "active");
CREATE INDEX "DeliveryRoute_companyId_status_idx" ON "DeliveryRoute"("companyId", "status");
CREATE INDEX "DeliveryRoute_driverId_createdAt_idx" ON "DeliveryRoute"("driverId", "createdAt");
CREATE UNIQUE INDEX "DeliveryRouteOrder_routeId_orderId_key" ON "DeliveryRouteOrder"("routeId", "orderId");
CREATE UNIQUE INDEX "DeliveryRouteOrder_routeId_sequence_key" ON "DeliveryRouteOrder"("routeId", "sequence");
CREATE INDEX "DeliveryRouteOrder_companyId_idx" ON "DeliveryRouteOrder"("companyId");
CREATE INDEX "DeliveryRouteOrder_orderId_idx" ON "DeliveryRouteOrder"("orderId");

ALTER TABLE "Driver"
ADD CONSTRAINT "Driver_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryRoute"
ADD CONSTRAINT "DeliveryRoute_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryRoute"
ADD CONSTRAINT "DeliveryRoute_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryRouteOrder"
ADD CONSTRAINT "DeliveryRouteOrder_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryRouteOrder"
ADD CONSTRAINT "DeliveryRouteOrder_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryRouteOrder"
ADD CONSTRAINT "DeliveryRouteOrder_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
