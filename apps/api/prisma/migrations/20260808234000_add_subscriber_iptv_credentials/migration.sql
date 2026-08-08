-- Each GuiGuiPlayer subscriber owns an independent IPTV profile.
ALTER TABLE "AppSubscriber"
ADD COLUMN IF NOT EXISTS "serverEncrypted" TEXT,
ADD COLUMN IF NOT EXISTS "usernameEncrypted" TEXT,
ADD COLUMN IF NOT EXISTS "passwordEncrypted" TEXT;
