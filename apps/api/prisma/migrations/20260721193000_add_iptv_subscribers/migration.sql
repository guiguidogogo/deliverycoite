-- Independent IPTV subscribers managed by each GuiGuiPlayer reseller.
CREATE TYPE "AppSubscriberPlan" AS ENUM (
    'TRIAL_7_DAYS',
    'DAYS_30',
    'DAYS_60',
    'DAYS_90',
    'MONTHS_6',
    'YEAR_1',
    'LIFETIME'
);

CREATE TABLE "AppSubscriber" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "plan" "AppSubscriberPlan" NOT NULL DEFAULT 'TRIAL_7_DAYS',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "activationCodeHash" TEXT NOT NULL,
    "activationCodeEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSubscriber_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AppDevice" ADD COLUMN "subscriberId" TEXT;
ALTER TABLE "AppPairing" ADD COLUMN "subscriberId" TEXT;

CREATE UNIQUE INDEX "AppSubscriber_activationCodeHash_key" ON "AppSubscriber"("activationCodeHash");
CREATE INDEX "AppSubscriber_subscriptionId_active_idx" ON "AppSubscriber"("subscriptionId", "active");
CREATE INDEX "AppSubscriber_subscriptionId_expiresAt_idx" ON "AppSubscriber"("subscriptionId", "expiresAt");
CREATE INDEX "AppDevice_subscriberId_active_idx" ON "AppDevice"("subscriberId", "active");
CREATE INDEX "AppPairing_subscriberId_status_idx" ON "AppPairing"("subscriberId", "status");

ALTER TABLE "AppSubscriber" ADD CONSTRAINT "AppSubscriber_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AppSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppDevice" ADD CONSTRAINT "AppDevice_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "AppSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppPairing" ADD CONSTRAINT "AppPairing_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "AppSubscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
