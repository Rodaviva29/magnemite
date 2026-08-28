-- CreateTable
CREATE TABLE `AppTargetSource` (
    `appTargetId` VARCHAR(191) NOT NULL,
    `feedId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppTargetSource_feedId_idx`(`feedId`),
    PRIMARY KEY (`appTargetId`, `feedId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AppTargetSource` ADD CONSTRAINT `AppTargetSource_appTargetId_fkey` FOREIGN KEY (`appTargetId`) REFERENCES `AppTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppTargetSource` ADD CONSTRAINT `AppTargetSource_feedId_fkey` FOREIGN KEY (`feedId`) REFERENCES `SourceFeed`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Every feed was polled for every target before this table existed, so the
-- pairing that preserves today's behaviour is the full cross product. Manual
-- targets are excluded: nothing polls them.
INSERT INTO `AppTargetSource` (`appTargetId`, `feedId`)
SELECT t.`id`, f.`id`
FROM `AppTarget` t
CROSS JOIN `SourceFeed` f
WHERE t.`manual` = false;
