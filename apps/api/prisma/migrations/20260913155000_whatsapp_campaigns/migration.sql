CREATE TYPE "WhatsappCampaignStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED', 'CANCELED');
CREATE TYPE "WhatsappCampaignRecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED');

CREATE TABLE "WhatsappCampaign" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "batchSize" INTEGER NOT NULL DEFAULT 5,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "status" "WhatsappCampaignStatus" NOT NULL DEFAULT 'RUNNING',
  "nextBatchAt" TIMESTAMP(3) NOT NULL,
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappCampaignRecipient" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "status" "WhatsappCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "gatewayJobId" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsappCampaign_companyId_createdAt_idx" ON "WhatsappCampaign"("companyId", "createdAt");
CREATE INDEX "WhatsappCampaign_status_nextBatchAt_idx" ON "WhatsappCampaign"("status", "nextBatchAt");
CREATE UNIQUE INDEX "WhatsappCampaignRecipient_campaignId_phone_key" ON "WhatsappCampaignRecipient"("campaignId", "phone");
CREATE INDEX "WhatsappCampaignRecipient_companyId_status_idx" ON "WhatsappCampaignRecipient"("companyId", "status");
CREATE INDEX "WhatsappCampaignRecipient_campaignId_status_createdAt_idx" ON "WhatsappCampaignRecipient"("campaignId", "status", "createdAt");

ALTER TABLE "WhatsappCampaign" ADD CONSTRAINT "WhatsappCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappCampaignRecipient" ADD CONSTRAINT "WhatsappCampaignRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappCampaignRecipient" ADD CONSTRAINT "WhatsappCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WhatsappCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappCampaignRecipient" ADD CONSTRAINT "WhatsappCampaignRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
