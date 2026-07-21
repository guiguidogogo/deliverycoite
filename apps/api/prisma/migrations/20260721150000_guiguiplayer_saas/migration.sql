-- GuiGuiPlayer SaaS subscriptions, encrypted IPTV profiles, devices and pairing sessions.
CREATE TYPE "AppProduct" AS ENUM ('GUIGUI_PLAYER');
CREATE TYPE "AppPairingStatus" AS ENUM ('PENDING', 'PAIRED', 'ACKNOWLEDGED', 'EXPIRED');

CREATE TABLE "AppSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "product" "AppProduct" NOT NULL DEFAULT 'GUIGUI_PLAYER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "activationCodeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppIptvCredentials" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "serverEncrypted" TEXT NOT NULL,
    "usernameEncrypted" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppIptvCredentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppDevice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppPairing" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "status" "AppPairingStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pairedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppPairing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppIptvCredentials_subscriptionId_key" ON "AppIptvCredentials"("subscriptionId");
CREATE UNIQUE INDEX "AppSubscription_activationCodeHash_key" ON "AppSubscription"("activationCodeHash");
CREATE UNIQUE INDEX "AppDevice_subscriptionId_deviceIdHash_key" ON "AppDevice"("subscriptionId", "deviceIdHash");
CREATE UNIQUE INDEX "AppPairing_code_key" ON "AppPairing"("code");
CREATE INDEX "AppSubscription_companyId_active_idx" ON "AppSubscription"("companyId", "active");
CREATE INDEX "AppSubscription_product_active_expiresAt_idx" ON "AppSubscription"("product", "active", "expiresAt");
CREATE INDEX "AppDevice_subscriptionId_active_idx" ON "AppDevice"("subscriptionId", "active");
CREATE INDEX "AppDevice_deviceIdHash_idx" ON "AppDevice"("deviceIdHash");
CREATE INDEX "AppPairing_deviceIdHash_status_idx" ON "AppPairing"("deviceIdHash", "status");
CREATE INDEX "AppPairing_subscriptionId_status_idx" ON "AppPairing"("subscriptionId", "status");
CREATE INDEX "AppPairing_expiresAt_idx" ON "AppPairing"("expiresAt");

ALTER TABLE "AppSubscription" ADD CONSTRAINT "AppSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppIptvCredentials" ADD CONSTRAINT "AppIptvCredentials_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AppSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppDevice" ADD CONSTRAINT "AppDevice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AppSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppPairing" ADD CONSTRAINT "AppPairing_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AppSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
