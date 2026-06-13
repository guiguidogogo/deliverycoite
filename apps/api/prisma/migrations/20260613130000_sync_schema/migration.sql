-- Bring databases created by the existing migrations in sync with schema.prisma.

ALTER TABLE `Customer`
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `passwordHash` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `Customer_email_key`(`email`);

ALTER TABLE `Coupon`
    ADD COLUMN `maxUses` INTEGER NULL,
    ADD COLUMN `maxUsesPerCustomer` INTEGER NULL,
    ADD COLUMN `maxUsesPerDay` INTEGER NULL;

ALTER TABLE `Order`
    MODIFY COLUMN `status` ENUM(
        'RECEIVED',
        'PREPARING',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'FINISHED',
        'CANCELED'
    ) NOT NULL DEFAULT 'RECEIVED',
    ADD COLUMN `customerNotes` VARCHAR(191) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paidMethodDetail` VARCHAR(191) NULL,
    ADD COLUMN `sentToDelivery` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deliverySentAt` DATETIME(3) NULL;

ALTER TABLE `Setting`
    ADD COLUMN `deliveryPhoneNumber` VARCHAR(191) NULL;

CREATE TABLE `CustomerAddress` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `district` VARCHAR(191) NOT NULL,
    `complement` VARCHAR(191) NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerAddress_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CashSession` (
    `id` VARCHAR(191) NOT NULL,
    `openedBy` VARCHAR(191) NOT NULL,
    `openingAmount` DECIMAL(10, 2) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `closingAmount` DECIMAL(10, 2) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `CashSession_openedAt_idx`(`openedAt`),
    INDEX `CashSession_closedAt_idx`(`closedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CashEntry` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `type` ENUM('OPENING', 'WITHDRAWAL', 'EXPENSE', 'MANUAL_INCOME', 'CLOSING') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'PIX', 'CARD') NULL,
    `orderId` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CashEntry_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CouponRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `couponId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CouponRedemption_orderId_key`(`orderId`),
    INDEX `CouponRedemption_couponId_usedAt_idx`(`couponId`, `usedAt`),
    INDEX `CouponRedemption_customerId_usedAt_idx`(`customerId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerAddress`
    ADD CONSTRAINT `CustomerAddress_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CashEntry`
    ADD CONSTRAINT `CashEntry_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `CashSession`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CouponRedemption`
    ADD CONSTRAINT `CouponRedemption_couponId_fkey`
    FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `CouponRedemption_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `CouponRedemption_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
