CREATE TABLE "AppDeviceTrial" (
    "id" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppDeviceTrial_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AppPairing" ADD COLUMN "trialId" TEXT;

CREATE UNIQUE INDEX "AppDeviceTrial_deviceIdHash_key" ON "AppDeviceTrial"("deviceIdHash");
CREATE INDEX "AppDeviceTrial_expiresAt_idx" ON "AppDeviceTrial"("expiresAt");
CREATE INDEX "AppPairing_trialId_status_idx" ON "AppPairing"("trialId", "status");

ALTER TABLE "AppPairing"
ADD CONSTRAINT "AppPairing_trialId_fkey"
FOREIGN KEY ("trialId") REFERENCES "AppDeviceTrial"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
