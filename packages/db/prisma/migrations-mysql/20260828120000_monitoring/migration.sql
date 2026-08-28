-- Monitoring: rules that watch a box and act when it stops working.
--
-- Nothing here is seeded by this migration. The hub writes the default rules
-- on first boot, all disabled, because a fleet that upgraded into a running
-- watchdog would start rebooting itself before anyone had read the settings.
--
-- The two new Device booleans default to what preserves today's reading of an
-- existing row: Rotom is assumed to have a box enabled until a sync says
-- otherwise, and assumed not to be handing it work until one confirms it.

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `foregroundPackage` VARCHAR(191) NULL,
    ADD COLUMN `monitorReportedAt` DATETIME(3) NULL,
    ADD COLUMN `rotomCanBeUsed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rotomEnabled` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `MonitorRule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `groupId` VARCHAR(191) NULL,
    `signal` ENUM('AGENT_OFFLINE', 'SERVICE_DOWN', 'APP_NOT_FOREGROUND', 'APP_ANR', 'HEALTH_CHECK_FAILED', 'LOOP_STALLED', 'ROTOM_DISCONNECTED') NOT NULL,
    `packageName` VARCHAR(191) NULL,
    `config` JSON NOT NULL,
    `threshold` INTEGER NOT NULL DEFAULT 1,
    `cooldownSeconds` INTEGER NOT NULL DEFAULT 300,
    `windowStart` VARCHAR(191) NULL,
    `windowEnd` VARCHAR(191) NULL,
    `notifyLevel` ENUM('INFO', 'WARN', 'CRITICAL') NOT NULL DEFAULT 'WARN',
    `notify` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MonitorRule_enabled_signal_idx`(`enabled`, `signal`),
    INDEX `MonitorRule_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonitorStep` (
    `id` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `atFailure` INTEGER NOT NULL,
    `action` ENUM('NOTIFY_ONLY', 'RESTART_APP', 'KILL_APP', 'CLEAR_CACHE_RESTART', 'SEND_KEYEVENT', 'START_SERVICE', 'SHELL', 'REBOOT', 'ROTOM_RESTART') NOT NULL,
    `command` VARCHAR(191) NULL,

    UNIQUE INDEX `MonitorStep_ruleId_atFailure_key`(`ruleId`, `atFailure`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonitorState` (
    `deviceId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `failures` INTEGER NOT NULL DEFAULT 0,
    `firstFailedAt` DATETIME(3) NULL,
    `lastActionAt` DATETIME(3) NULL,
    `lastStepFired` INTEGER NULL,

    INDEX `MonitorState_ruleId_idx`(`ruleId`),
    PRIMARY KEY (`deviceId`, `ruleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonitorEvent` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NULL,
    `signal` ENUM('AGENT_OFFLINE', 'SERVICE_DOWN', 'APP_NOT_FOREGROUND', 'APP_ANR', 'HEALTH_CHECK_FAILED', 'LOOP_STALLED', 'ROTOM_DISCONNECTED') NOT NULL,
    `level` ENUM('INFO', 'WARN', 'CRITICAL') NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `action` ENUM('NOTIFY_ONLY', 'RESTART_APP', 'KILL_APP', 'CLEAR_CACHE_RESTART', 'SEND_KEYEVENT', 'START_SERVICE', 'SHELL', 'REBOOT', 'ROTOM_RESTART') NULL,
    `actionOk` BOOLEAN NULL,
    -- TEXT rather than the VARCHAR(191) a String gets by default: the agent
    -- caps a probe's detail at 512 bytes, and a truncated explanation of why
    -- a box was rebooted is worse than no explanation at all.
    `detail` TEXT NULL,
    `notified` BOOLEAN NOT NULL DEFAULT false,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MonitorEvent_deviceId_at_idx`(`deviceId`, `at`),
    INDEX `MonitorEvent_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MonitorRule` ADD CONSTRAINT `MonitorRule_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `DeviceGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonitorStep` ADD CONSTRAINT `MonitorStep_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `MonitorRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonitorState` ADD CONSTRAINT `MonitorState_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonitorState` ADD CONSTRAINT `MonitorState_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `MonitorRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonitorEvent` ADD CONSTRAINT `MonitorEvent_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
