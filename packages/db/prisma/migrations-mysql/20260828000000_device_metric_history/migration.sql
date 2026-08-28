-- Health history for the /devices/[id]/metrics charts, plus the thermal
-- readings the agent now gathers.
--
-- Two tables rather than one wide one: an app that is not running has no
-- per-package row at all, which is what makes "the scanner was dead from 3am"
-- read as a gap rather than as a flat zero. Both are pruned by the hub against
-- the metricsRetentionDays setting.

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `batteryTempC` DOUBLE NULL,
    ADD COLUMN `cpuTempC` DOUBLE NULL;

-- CreateTable
CREATE TABLE `DeviceMetricSample` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deviceId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `loadAvg1` DOUBLE NULL,
    `loadAvg5` DOUBLE NULL,
    `loadAvg15` DOUBLE NULL,
    `cpuCount` INTEGER NULL,
    `memTotalBytes` BIGINT NULL,
    `memAvailableBytes` BIGINT NULL,
    `freeBytes` BIGINT NULL,
    `totalBytes` BIGINT NULL,
    `cpuTempC` DOUBLE NULL,
    `batteryTempC` DOUBLE NULL,

    INDEX `DeviceMetricSample_deviceId_at_idx`(`deviceId`, `at`),
    INDEX `DeviceMetricSample_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevicePackageMetricSample` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deviceId` VARCHAR(191) NOT NULL,
    `packageName` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cpuPercent` DOUBLE NULL,
    `rssBytes` BIGINT NULL,
    `processCount` INTEGER NULL,

    INDEX `DevicePackageMetricSample_deviceId_at_idx`(`deviceId`, `at`),
    INDEX `DevicePackageMetricSample_deviceId_packageName_at_idx`(`deviceId`, `packageName`, `at`),
    INDEX `DevicePackageMetricSample_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DeviceMetricSample` ADD CONSTRAINT `DeviceMetricSample_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevicePackageMetricSample` ADD CONSTRAINT `DevicePackageMetricSample_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
