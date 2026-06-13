-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `menuiaApiKey` VARCHAR(191) NULL,
    ADD COLUMN `menuiaEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `menuiaStoreId` VARCHAR(191) NULL;
