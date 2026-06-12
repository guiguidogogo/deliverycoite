ALTER TABLE `Order`
    ADD COLUMN `orderNumber` INTEGER NOT NULL AUTO_INCREMENT,
    ADD UNIQUE INDEX `Order_orderNumber_key`(`orderNumber`);

ALTER TABLE `Setting`
    ADD COLUMN `whatsappOnReceived` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnPreparing` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnOutForDelivery` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnDelivered` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnFinished` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnCanceled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsappOnPaymentConfirmed` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `printerEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `printerName` VARCHAR(191) NULL,
    ADD COLUMN `printerPaperWidth` INTEGER NOT NULL DEFAULT 58,
    ADD COLUMN `printerAutoPrint` BOOLEAN NOT NULL DEFAULT false;
