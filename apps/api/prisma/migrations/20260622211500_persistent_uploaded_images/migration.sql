CREATE TABLE IF NOT EXISTS "UploadedImage" (
  "id" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadedImage_pkey" PRIMARY KEY ("id")
);
