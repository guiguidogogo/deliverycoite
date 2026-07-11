DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClosedOrderPolicy') THEN
    CREATE TYPE "ClosedOrderPolicy" AS ENUM (
      'BLOCK_WHEN_CLOSED',
      'ALLOW_WHEN_CLOSED',
      'SCHEDULE_ONLY_WHEN_CLOSED'
    );
  END IF;
END $$;

ALTER TABLE "Setting"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Bahia',
  ADD COLUMN IF NOT EXISTS "closedOrderPolicy" "ClosedOrderPolicy" NOT NULL DEFAULT 'BLOCK_WHEN_CLOSED';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CompanyBusinessHour" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "isOpen" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyBusinessHour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CompanyBusinessHourPeriod" (
  "id" TEXT NOT NULL,
  "businessHourId" TEXT NOT NULL,
  "openingTime" TEXT NOT NULL,
  "closingTime" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyBusinessHourPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyBusinessHour_companyId_dayOfWeek_key"
  ON "CompanyBusinessHour"("companyId", "dayOfWeek");

CREATE INDEX IF NOT EXISTS "CompanyBusinessHour_companyId_idx"
  ON "CompanyBusinessHour"("companyId");

CREATE INDEX IF NOT EXISTS "CompanyBusinessHourPeriod_businessHourId_idx"
  ON "CompanyBusinessHourPeriod"("businessHourId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyBusinessHour_companyId_fkey'
  ) THEN
    ALTER TABLE "CompanyBusinessHour"
      ADD CONSTRAINT "CompanyBusinessHour_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyBusinessHourPeriod_businessHourId_fkey'
  ) THEN
    ALTER TABLE "CompanyBusinessHourPeriod"
      ADD CONSTRAINT "CompanyBusinessHourPeriod_businessHourId_fkey"
      FOREIGN KEY ("businessHourId") REFERENCES "CompanyBusinessHour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "CompanyBusinessHour" ("id", "companyId", "dayOfWeek", "isOpen", "createdAt", "updatedAt")
SELECT
  concat('bh_', md5(setting."companyId" || ':' || days.day::text)),
  setting."companyId",
  days.day,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Setting" setting
CROSS JOIN generate_series(0, 6) AS days(day)
ON CONFLICT ("companyId", "dayOfWeek") DO NOTHING;

INSERT INTO "CompanyBusinessHourPeriod" ("id", "businessHourId", "openingTime", "closingTime", "createdAt", "updatedAt")
SELECT
  concat('bhp_', md5(setting."companyId" || ':' || hours."dayOfWeek"::text || ':' || setting."openTime" || ':' || setting."closeTime")),
  hours."id",
  setting."openTime",
  setting."closeTime",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Setting" setting
JOIN "CompanyBusinessHour" hours ON hours."companyId" = setting."companyId"
WHERE setting."openTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND setting."closeTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND setting."openTime" <> setting."closeTime"
  AND setting."openTime"::time < setting."closeTime"::time
  AND NOT EXISTS (
    SELECT 1
    FROM "CompanyBusinessHourPeriod" existing
    WHERE existing."businessHourId" = hours."id"
  );
