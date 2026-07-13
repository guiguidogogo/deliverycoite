DO $$ BEGIN
  CREATE TYPE "BusinessType" AS ENUM ('FOOD', 'EVENTS', 'BARBERSHOP', 'BEAUTY_SALON', 'PHARMACY', 'MARKET', 'CLINIC', 'SERVICES', 'RAFFLE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED', 'FINISHED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RaffleNumberStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'PENDING_PAYMENT', 'PAID', 'BLOCKED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RaffleOrderStatus" AS ENUM ('RESERVED', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RafflePaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RaffleMediaType" AS ENUM ('IMAGE', 'VIDEO', 'THUMBNAIL', 'SHARE_BANNER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "businessType" "BusinessType" NOT NULL DEFAULT 'FOOD';

CREATE TABLE IF NOT EXISTS "Raffle" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "regulation" TEXT,
  "prize" TEXT,
  "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "numberStart" INTEGER NOT NULL DEFAULT 0,
  "numberEnd" INTEGER NOT NULL,
  "numberDigits" INTEGER NOT NULL DEFAULT 2,
  "totalNumbers" INTEGER NOT NULL,
  "pricePerNumber" DECIMAL(10,2) NOT NULL,
  "minimumQuantity" INTEGER NOT NULL DEFAULT 1,
  "maximumQuantity" INTEGER NOT NULL DEFAULT 10,
  "participantLimit" INTEGER,
  "featuredImageUrl" TEXT,
  "videoUrl" TEXT,
  "publishedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleParticipant" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT,
  "name" TEXT NOT NULL,
  "birthDate" TIMESTAMP(3),
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "cpf" TEXT,
  "passwordHash" TEXT,
  "acceptedTermsAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RaffleParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleOrder" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "status" "RaffleOrderStatus" NOT NULL DEFAULT 'RESERVED',
  "paymentMethod" TEXT,
  "paymentStatus" "RafflePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "subtotal" DECIMAL(10,2) NOT NULL,
  "cardFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(10,2) NOT NULL,
  "mercadoPagoPaymentId" TEXT,
  "mercadoPagoPreferenceId" TEXT,
  "pixQrCode" TEXT,
  "pixCopiaCola" TEXT,
  "reservationExpiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RaffleOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleNumber" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "formattedNumber" TEXT NOT NULL,
  "status" "RaffleNumberStatus" NOT NULL DEFAULT 'AVAILABLE',
  "reservedByParticipantId" TEXT,
  "reservedUntil" TIMESTAMP(3),
  "orderId" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RaffleNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleOrderItem" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "raffleNumberId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "formattedNumber" TEXT NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaffleOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RafflePayment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
  "providerPaymentId" TEXT,
  "providerEventId" TEXT,
  "method" TEXT,
  "status" "RafflePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(10,2) NOT NULL,
  "payload" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RafflePayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleMedia" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "type" "RaffleMediaType" NOT NULL DEFAULT 'IMAGE',
  "url" TEXT NOT NULL,
  "title" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaffleMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleWinner" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "raffleNumberId" TEXT,
  "number" INTEGER NOT NULL,
  "formattedNumber" TEXT NOT NULL,
  "participantName" TEXT,
  "participantPhone" TEXT,
  "drawMethod" TEXT,
  "proofUrl" TEXT,
  "notes" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaffleWinner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RaffleAuditLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "raffleId" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaffleAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Raffle_companyId_slug_key" ON "Raffle"("companyId", "slug");
CREATE INDEX IF NOT EXISTS "Raffle_companyId_status_idx" ON "Raffle"("companyId", "status");
CREATE INDEX IF NOT EXISTS "Raffle_companyId_startsAt_endsAt_idx" ON "Raffle"("companyId", "startsAt", "endsAt");

CREATE UNIQUE INDEX IF NOT EXISTS "RaffleNumber_raffleId_number_key" ON "RaffleNumber"("raffleId", "number");
CREATE INDEX IF NOT EXISTS "RaffleNumber_companyId_status_idx" ON "RaffleNumber"("companyId", "status");
CREATE INDEX IF NOT EXISTS "RaffleNumber_raffleId_status_idx" ON "RaffleNumber"("raffleId", "status");
CREATE INDEX IF NOT EXISTS "RaffleNumber_reservedUntil_idx" ON "RaffleNumber"("reservedUntil");

CREATE UNIQUE INDEX IF NOT EXISTS "RaffleParticipant_companyId_phone_key" ON "RaffleParticipant"("companyId", "phone");
CREATE INDEX IF NOT EXISTS "RaffleParticipant_companyId_email_idx" ON "RaffleParticipant"("companyId", "email");
CREATE INDEX IF NOT EXISTS "RaffleParticipant_companyId_cpf_idx" ON "RaffleParticipant"("companyId", "cpf");

CREATE INDEX IF NOT EXISTS "RaffleOrder_companyId_status_idx" ON "RaffleOrder"("companyId", "status");
CREATE INDEX IF NOT EXISTS "RaffleOrder_raffleId_status_idx" ON "RaffleOrder"("raffleId", "status");
CREATE INDEX IF NOT EXISTS "RaffleOrder_participantId_idx" ON "RaffleOrder"("participantId");
CREATE INDEX IF NOT EXISTS "RaffleOrder_reservationExpiresAt_idx" ON "RaffleOrder"("reservationExpiresAt");
CREATE INDEX IF NOT EXISTS "RaffleOrder_mercadoPagoPaymentId_idx" ON "RaffleOrder"("mercadoPagoPaymentId");

CREATE UNIQUE INDEX IF NOT EXISTS "RaffleOrderItem_orderId_raffleNumberId_key" ON "RaffleOrderItem"("orderId", "raffleNumberId");
CREATE INDEX IF NOT EXISTS "RaffleOrderItem_companyId_idx" ON "RaffleOrderItem"("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "RafflePayment_provider_providerEventId_key" ON "RafflePayment"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "RafflePayment_companyId_status_idx" ON "RafflePayment"("companyId", "status");
CREATE INDEX IF NOT EXISTS "RafflePayment_providerPaymentId_idx" ON "RafflePayment"("providerPaymentId");

CREATE INDEX IF NOT EXISTS "RaffleMedia_companyId_raffleId_idx" ON "RaffleMedia"("companyId", "raffleId");
CREATE INDEX IF NOT EXISTS "RaffleWinner_companyId_raffleId_idx" ON "RaffleWinner"("companyId", "raffleId");
CREATE INDEX IF NOT EXISTS "RaffleAuditLog_companyId_createdAt_idx" ON "RaffleAuditLog"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "RaffleAuditLog_companyId_raffleId_idx" ON "RaffleAuditLog"("companyId", "raffleId");

ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleParticipant" ADD CONSTRAINT "RaffleParticipant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleParticipant" ADD CONSTRAINT "RaffleParticipant_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RaffleOrder" ADD CONSTRAINT "RaffleOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleOrder" ADD CONSTRAINT "RaffleOrder_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleOrder" ADD CONSTRAINT "RaffleOrder_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "RaffleParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaffleNumber" ADD CONSTRAINT "RaffleNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleNumber" ADD CONSTRAINT "RaffleNumber_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleNumber" ADD CONSTRAINT "RaffleNumber_reservedByParticipantId_fkey" FOREIGN KEY ("reservedByParticipantId") REFERENCES "RaffleParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RaffleNumber" ADD CONSTRAINT "RaffleNumber_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RaffleOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RaffleOrderItem" ADD CONSTRAINT "RaffleOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RaffleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RaffleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleMedia" ADD CONSTRAINT "RaffleMedia_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleWinner" ADD CONSTRAINT "RaffleWinner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleAuditLog" ADD CONSTRAINT "RaffleAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleAuditLog" ADD CONSTRAINT "RaffleAuditLog_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
