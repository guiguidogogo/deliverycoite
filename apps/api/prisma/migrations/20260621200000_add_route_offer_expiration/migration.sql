ALTER TABLE "DeliveryRoute"
ADD COLUMN "offerExpiresAt" TIMESTAMP(3);

CREATE INDEX "DeliveryRoute_status_offerExpiresAt_idx"
ON "DeliveryRoute"("status", "offerExpiresAt");
