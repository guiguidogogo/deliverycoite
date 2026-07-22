-- Encrypted, short-lived credentials supplied through the unique Roku pairing page.
ALTER TABLE "AppPairing"
ADD COLUMN "serverEncrypted" TEXT,
ADD COLUMN "usernameEncrypted" TEXT,
ADD COLUMN "passwordEncrypted" TEXT;
