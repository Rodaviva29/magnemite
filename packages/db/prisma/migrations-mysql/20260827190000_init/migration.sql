-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serial` VARCHAR(191) NOT NULL,
    `manufacturer` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `androidVersion` VARCHAR(191) NULL,
    `sdkInt` INTEGER NULL,
    `abi` VARCHAR(191) NULL,
    `agentVersion` VARCHAR(191) NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ONLINE', 'OFFLINE') NOT NULL DEFAULT 'OFFLINE',
    `lastSeenAt` DATETIME(3) NULL,
    `publicIp` VARCHAR(191) NULL,
    `localIp` VARCHAR(191) NULL,
    `freeBytes` BIGINT NULL,
    `totalBytes` BIGINT NULL,
    `uptimeSeconds` INTEGER NULL,
    `loadAvg1` DOUBLE NULL,
    `loadAvg5` DOUBLE NULL,
    `loadAvg15` DOUBLE NULL,
    `cpuCount` INTEGER NULL,
    `memTotalBytes` BIGINT NULL,
    `memAvailableBytes` BIGINT NULL,
    `packagesSyncedAt` DATETIME(3) NULL,
    `rotomOrigin` VARCHAR(191) NULL,
    `rotomDeviceId` VARCHAR(191) NULL,
    `rotomConnected` BOOLEAN NOT NULL DEFAULT false,
    `rotomWorkerCount` INTEGER NULL,
    `rotomLastSeenAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `groupId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Device_serial_key`(`serial`),
    UNIQUE INDEX `Device_tokenHash_key`(`tokenHash`),
    INDEX `Device_status_idx`(`status`),
    INDEX `Device_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentUpdate` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `fromVersion` VARCHAR(191) NULL,
    `toVersion` VARCHAR(191) NOT NULL,
    `state` ENUM('SENT', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'SENT',
    `error` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `AgentUpdate_deviceId_sentAt_idx`(`deviceId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceLogBundle` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `state` ENUM('PENDING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `path` VARCHAR(191) NULL,
    `sizeBytes` BIGINT NULL,
    `error` VARCHAR(191) NULL,
    `requestedById` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `DeviceLogBundle_deviceId_requestedAt_idx`(`deviceId`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WatchedPackage` (
    `id` VARCHAR(191) NOT NULL,
    `packageName` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WatchedPackage_packageName_key`(`packageName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevicePackage` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `packageName` VARCHAR(191) NOT NULL,
    `versionName` VARCHAR(191) NULL,
    `versionCode` BIGINT NULL,
    `installed` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevicePackage_packageName_versionName_idx`(`packageName`, `versionName`),
    UNIQUE INDEX `DevicePackage_deviceId_packageName_key`(`deviceId`, `packageName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `preInstallHook` VARCHAR(191) NULL,
    `postInstallHook` VARCHAR(191) NULL,
    `maxConcurrency` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeviceGroup_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppTarget` (
    `id` VARCHAR(191) NOT NULL,
    `packageName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `manual` BOOLEAN NOT NULL DEFAULT false,
    `arch` VARCHAR(191) NOT NULL DEFAULT 'arm64-v8a',
    `autoUpdateEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoApprove` BOOLEAN NOT NULL DEFAULT false,
    `canaryCount` INTEGER NOT NULL DEFAULT 1,
    `soakMinutes` INTEGER NOT NULL DEFAULT 30,
    `maxConcurrency` INTEGER NULL,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `windowStart` VARCHAR(191) NULL,
    `windowEnd` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppTarget_packageName_key`(`packageName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SourceFeed` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `indexUrl` VARCHAR(191) NOT NULL,
    `baseUrl` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SourceFeed_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppVersion` (
    `id` VARCHAR(191) NOT NULL,
    `appTargetId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `buildCode` VARCHAR(191) NULL,
    `versionCode` BIGINT NULL,
    `source` ENUM('MIRROR', 'MANUAL') NOT NULL,
    `feedId` VARCHAR(191) NULL,
    `arch` VARCHAR(191) NOT NULL DEFAULT 'arm64-v8a',
    `remoteUrl` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `md5` VARCHAR(191) NULL,
    `sha256` VARCHAR(191) NULL,
    `artifactPath` VARCHAR(191) NULL,
    `status` ENUM('DISCOVERED', 'CACHING', 'READY', 'FAILED') NOT NULL DEFAULT 'DISCOVERED',
    `cacheProgress` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(191) NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NULL,
    `discoveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppVersion_status_idx`(`status`),
    UNIQUE INDEX `AppVersion_appTargetId_version_arch_key`(`appTargetId`, `version`, `arch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rollout` (
    `id` VARCHAR(191) NOT NULL,
    `appVersionId` VARCHAR(191) NOT NULL,
    `mode` ENUM('MANUAL', 'AUTO') NOT NULL DEFAULT 'MANUAL',
    `status` ENUM('PENDING', 'CANARY', 'SOAKING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `forceClean` BOOLEAN NOT NULL DEFAULT false,
    `canaryCount` INTEGER NOT NULL DEFAULT 0,
    `soakMinutes` INTEGER NOT NULL DEFAULT 0,
    `maxConcurrency` INTEGER NULL,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `preInstallHook` VARCHAR(191) NULL,
    `postInstallHook` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `canaryPassedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `Rollout_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `rolloutId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `state` ENUM('QUEUED', 'DISPATCHED', 'DOWNLOADING', 'EXTRACTING', 'INSTALLING', 'VERIFYING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `isCanary` BOOLEAN NOT NULL DEFAULT false,
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(191) NULL,
    `installMode` ENUM('IN_PLACE', 'CLEAN') NULL,
    `dataWiped` BOOLEAN NOT NULL DEFAULT false,
    `fromVersion` VARCHAR(191) NULL,
    `toVersion` VARCHAR(191) NOT NULL,
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dispatchedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `heartbeatAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `Job_state_idx`(`state`),
    INDEX `Job_deviceId_state_idx`(`deviceId`, `state`),
    UNIQUE INDEX `Job_rolloutId_deviceId_key`(`rolloutId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobEvent` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `level` ENUM('DEBUG', 'INFO', 'WARN', 'ERROR') NOT NULL DEFAULT 'INFO',
    `phase` ENUM('QUEUED', 'DISPATCHED', 'DOWNLOADING', 'EXTRACTING', 'INSTALLING', 'VERIFYING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED') NULL,
    `message` VARCHAR(191) NOT NULL,

    INDEX `JobEvent_jobId_ts_idx`(`jobId`, `ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EnrollmentToken` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `autoApprove` BOOLEAN NOT NULL DEFAULT true,
    `maxUses` INTEGER NULL,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EnrollmentToken_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `email` VARCHAR(191) NOT NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `image` VARCHAR(191) NULL,
    `role` ENUM('ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session` (
    `id` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `session_token_key`(`token`),
    INDEX `session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account` (
    `id` VARCHAR(191) NOT NULL,
    `issuer` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accessToken` VARCHAR(191) NULL,
    `refreshToken` VARCHAR(191) NULL,
    `idToken` VARCHAR(191) NULL,
    `accessTokenExpiresAt` DATETIME(3) NULL,
    `refreshTokenExpiresAt` DATETIME(3) NULL,
    `scope` VARCHAR(191) NULL,
    `password` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `account_userId_idx`(`userId`),
    UNIQUE INDEX `account_issuer_accountId_key`(`issuer`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification` (
    `id` VARCHAR(191) NOT NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `verification_identifier_idx`(`identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `userEmail` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `DeviceGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentUpdate` ADD CONSTRAINT `AgentUpdate_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceLogBundle` ADD CONSTRAINT `DeviceLogBundle_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevicePackage` ADD CONSTRAINT `DevicePackage_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppVersion` ADD CONSTRAINT `AppVersion_appTargetId_fkey` FOREIGN KEY (`appTargetId`) REFERENCES `AppTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppVersion` ADD CONSTRAINT `AppVersion_feedId_fkey` FOREIGN KEY (`feedId`) REFERENCES `SourceFeed`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rollout` ADD CONSTRAINT `Rollout_appVersionId_fkey` FOREIGN KEY (`appVersionId`) REFERENCES `AppVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rollout` ADD CONSTRAINT `Rollout_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_rolloutId_fkey` FOREIGN KEY (`rolloutId`) REFERENCES `Rollout`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobEvent` ADD CONSTRAINT `JobEvent_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session` ADD CONSTRAINT `session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account` ADD CONSTRAINT `account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

