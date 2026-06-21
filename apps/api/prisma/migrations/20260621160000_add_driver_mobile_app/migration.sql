ALTER TABLE "Driver"
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lastLatitude" DOUBLE PRECISION,
ADD COLUMN "lastLongitude" DOUBLE PRECISION,
ADD COLUMN "lastLocationAt" TIMESTAMP(3);

ALTER TABLE "DeliveryRoute"
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "declinedAt" TIMESTAMP(3);

CREATE TABLE "DriverDeviceToken" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "expoToken" TEXT NOT NULL,
  "platform" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverDeviceToken_expoToken_key" ON "DriverDeviceToken"("expoToken");
CREATE INDEX "DriverDeviceToken_companyId_driverId_idx" ON "DriverDeviceToken"("companyId", "driverId");

ALTER TABLE "DriverDeviceToken"
ADD CONSTRAINT "DriverDeviceToken_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverDeviceToken"
ADD CONSTRAINT "DriverDeviceToken_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
