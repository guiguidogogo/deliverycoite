CREATE TYPE "WhatsappConversationState" AS ENUM (
  'IDLE', 'BROWSING_MENU', 'SELECTING_PRODUCT', 'SELECTING_OPTIONS', 'CART',
  'AWAITING_ADDRESS', 'AWAITING_LOCATION', 'AWAITING_PAYMENT_METHOD',
  'AWAITING_CONFIRMATION', 'ORDER_CONFIRMED', 'HUMAN_SUPPORT'
);

CREATE TYPE "WhatsappMessageActor" AS ENUM ('CUSTOMER', 'AI', 'ATTENDANT', 'SYSTEM');

CREATE TABLE "WhatsappConversation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT,
  "phone" TEXT NOT NULL,
  "state" "WhatsappConversationState" NOT NULL DEFAULT 'IDLE',
  "context" JSONB NOT NULL DEFAULT '{}',
  "humanSupport" BOOLEAN NOT NULL DEFAULT false,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappConversationMessage" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "actor" "WhatsappMessageActor" NOT NULL,
  "body" TEXT NOT NULL,
  "intent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappWebhookEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappConversation_companyId_phone_key" ON "WhatsappConversation"("companyId", "phone");
CREATE INDEX "WhatsappConversation_companyId_state_idx" ON "WhatsappConversation"("companyId", "state");
CREATE INDEX "WhatsappConversation_companyId_lastMessageAt_idx" ON "WhatsappConversation"("companyId", "lastMessageAt");
CREATE INDEX "WhatsappConversation_customerId_idx" ON "WhatsappConversation"("customerId");
CREATE INDEX "WhatsappConversationMessage_companyId_conversationId_createdAt_idx" ON "WhatsappConversationMessage"("companyId", "conversationId", "createdAt");
CREATE UNIQUE INDEX "WhatsappWebhookEvent_companyId_externalId_key" ON "WhatsappWebhookEvent"("companyId", "externalId");
CREATE INDEX "WhatsappWebhookEvent_companyId_createdAt_idx" ON "WhatsappWebhookEvent"("companyId", "createdAt");

ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsappConversationMessage" ADD CONSTRAINT "WhatsappConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappWebhookEvent" ADD CONSTRAINT "WhatsappWebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
