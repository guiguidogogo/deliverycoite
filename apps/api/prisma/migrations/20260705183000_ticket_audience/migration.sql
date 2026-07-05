-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TicketAudience" AS ENUM ('GENERAL', 'MEN', 'WOMEN', 'COUPLE', 'STUDENT', 'VIP', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "TicketType"
ADD COLUMN IF NOT EXISTS "audience" "TicketAudience" NOT NULL DEFAULT 'GENERAL';
