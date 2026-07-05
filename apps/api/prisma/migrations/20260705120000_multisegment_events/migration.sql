DO $$ BEGIN
  CREATE TYPE "BusinessType" AS ENUM ('FOOD', 'EVENTS', 'BARBERSHOP', 'BEAUTY_SALON', 'PHARMACY', 'MARKET', 'CLINIC', 'SERVICES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TicketOrderStatus" AS ENUM ('RESERVED', 'PAID', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TicketPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TicketStatus" AS ENUM ('RESERVED', 'PAID', 'CANCELLED', 'USED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "businessType" "BusinessType" NOT NULL DEFAULT 'FOOD';

CREATE TABLE IF NOT EXISTS "Event" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "bannerUrl" TEXT,
  "location" TEXT NOT NULL,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT,
  "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TicketType" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10,2) NOT NULL,
  "quantityTotal" INTEGER NOT NULL,
  "quantitySold" INTEGER NOT NULL DEFAULT 0,
  "lotName" TEXT,
  "saleStart" TIMESTAMP(3),
  "saleEnd" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TicketOrder" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "customerEmail" TEXT,
  "total" DECIMAL(10,2) NOT NULL,
  "status" "TicketOrderStatus" NOT NULL DEFAULT 'RESERVED',
  "paymentMethod" "PaymentMethod",
  "paymentStatus" "TicketPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Ticket" (
  "id" TEXT NOT NULL,
  "ticketOrderId" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "qrCode" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'RESERVED',
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Event_companyId_status_eventDate_idx" ON "Event"("companyId", "status", "eventDate");
CREATE INDEX IF NOT EXISTS "TicketType_eventId_active_idx" ON "TicketType"("eventId", "active");
CREATE INDEX IF NOT EXISTS "TicketOrder_companyId_eventId_createdAt_idx" ON "TicketOrder"("companyId", "eventId", "createdAt");
CREATE INDEX IF NOT EXISTS "TicketOrder_companyId_status_paymentStatus_idx" ON "TicketOrder"("companyId", "status", "paymentStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_qrCode_key" ON "Ticket"("qrCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_code_key" ON "Ticket"("code");
CREATE INDEX IF NOT EXISTS "Ticket_ticketOrderId_idx" ON "Ticket"("ticketOrderId");
CREATE INDEX IF NOT EXISTS "Ticket_ticketTypeId_idx" ON "Ticket"("ticketTypeId");
CREATE INDEX IF NOT EXISTS "Ticket_status_idx" ON "Ticket"("status");

DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
