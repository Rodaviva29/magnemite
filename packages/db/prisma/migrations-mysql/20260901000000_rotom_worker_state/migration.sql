-- Rotom worker state: what the box is actually doing, not just whether it is
-- connected.
--
-- Every new column is nullable and every new enum value is unused until a rule
-- names it, so this migration changes nothing about a running fleet. The three
-- stat columns are null rather than zero on purpose: Rotom only measures
-- request rates in `requests` mode, or `proxy` mode with `inspect`, and a Rotom
-- that does not measure has to read as unknown. Zero there would mean every box
-- on a non-measuring Rotom looks idle.
--
-- MySQL spells an enum inline on every column that uses it, so widening one
-- means rewriting all four column definitions rather than the one type.

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `rotomWorkersInUse` INTEGER NULL,
    ADD COLUMN `rotomInUse` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rotomVersion` VARCHAR(191) NULL,
    ADD COLUMN `rotomRequestRate` DOUBLE NULL,
    ADD COLUMN `rotomRequestMs` DOUBLE NULL,
    ADD COLUMN `rotomStatWorkers` INTEGER NULL;

-- AlterTable
ALTER TABLE `MonitorRule` MODIFY `signal` ENUM('AGENT_OFFLINE', 'SERVICE_DOWN', 'APP_NOT_FOREGROUND', 'APP_ANR', 'HEALTH_CHECK_FAILED', 'LOOP_STALLED', 'ROTOM_DISCONNECTED', 'ROTOM_NOT_SCANNING', 'ROTOM_IDLE') NOT NULL;

-- AlterTable
ALTER TABLE `MonitorEvent` MODIFY `signal` ENUM('AGENT_OFFLINE', 'SERVICE_DOWN', 'APP_NOT_FOREGROUND', 'APP_ANR', 'HEALTH_CHECK_FAILED', 'LOOP_STALLED', 'ROTOM_DISCONNECTED', 'ROTOM_NOT_SCANNING', 'ROTOM_IDLE') NOT NULL;

-- AlterTable
ALTER TABLE `MonitorStep` MODIFY `action` ENUM('NOTIFY_ONLY', 'RESTART_APP', 'KILL_APP', 'CLEAR_CACHE_RESTART', 'SEND_KEYEVENT', 'START_SERVICE', 'SHELL', 'REBOOT', 'ROTOM_RESTART', 'ROTOM_DISCONNECT', 'ROTOM_REBOOT') NOT NULL;

-- AlterTable
ALTER TABLE `MonitorEvent` MODIFY `action` ENUM('NOTIFY_ONLY', 'RESTART_APP', 'KILL_APP', 'CLEAR_CACHE_RESTART', 'SEND_KEYEVENT', 'START_SERVICE', 'SHELL', 'REBOOT', 'ROTOM_RESTART', 'ROTOM_DISCONNECT', 'ROTOM_REBOOT') NULL;
