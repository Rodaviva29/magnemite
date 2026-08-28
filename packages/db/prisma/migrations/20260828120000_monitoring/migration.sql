-- Monitoring: rules that watch a box and act when it stops working.
--
-- Nothing here is seeded by this migration. The hub writes the default rules
-- on first boot, all disabled, because a fleet that upgraded into a running
-- watchdog would start rebooting itself before anyone had read the settings.
--
-- The two new Device booleans default to what preserves today's reading of an
-- existing row: Rotom is assumed to have a box enabled until a sync says
-- otherwise, and assumed not to be handing it work until one confirms it.

-- CreateEnum
CREATE TYPE "MonitorSignal" AS ENUM ('AGENT_OFFLINE', 'SERVICE_DOWN', 'APP_NOT_FOREGROUND', 'APP_ANR', 'HEALTH_CHECK_FAILED', 'LOOP_STALLED', 'ROTOM_DISCONNECTED');

-- CreateEnum
CREATE TYPE "MonitorAction" AS ENUM ('NOTIFY_ONLY', 'RESTART_APP', 'KILL_APP', 'CLEAR_CACHE_RESTART', 'SEND_KEYEVENT', 'START_SERVICE', 'SHELL', 'REBOOT', 'ROTOM_RESTART');

-- CreateEnum
CREATE TYPE "MonitorLevel" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "foregroundPackage" TEXT,
ADD COLUMN     "monitorReportedAt" TIMESTAMP(3),
ADD COLUMN     "rotomCanBeUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotomEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MonitorRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "groupId" TEXT,
    "signal" "MonitorSignal" NOT NULL,
    "packageName" TEXT,
    "config" JSONB NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "notifyLevel" "MonitorLevel" NOT NULL DEFAULT 'WARN',
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorStep" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "atFailure" INTEGER NOT NULL,
    "action" "MonitorAction" NOT NULL,
    "command" TEXT,

    CONSTRAINT "MonitorStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorState" (
    "deviceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3),
    "lastStepFired" INTEGER,

    CONSTRAINT "MonitorState_pkey" PRIMARY KEY ("deviceId","ruleId")
);

-- CreateTable
CREATE TABLE "MonitorEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "signal" "MonitorSignal" NOT NULL,
    "level" "MonitorLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "action" "MonitorAction",
    "actionOk" BOOLEAN,
    "detail" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorRule_enabled_signal_idx" ON "MonitorRule"("enabled", "signal");

-- CreateIndex
CREATE INDEX "MonitorRule_groupId_idx" ON "MonitorRule"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorStep_ruleId_atFailure_key" ON "MonitorStep"("ruleId", "atFailure");

-- CreateIndex
CREATE INDEX "MonitorState_ruleId_idx" ON "MonitorState"("ruleId");

-- CreateIndex
CREATE INDEX "MonitorEvent_deviceId_at_idx" ON "MonitorEvent"("deviceId", "at");

-- CreateIndex
CREATE INDEX "MonitorEvent_at_idx" ON "MonitorEvent"("at");

-- AddForeignKey
ALTER TABLE "MonitorRule" ADD CONSTRAINT "MonitorRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorStep" ADD CONSTRAINT "MonitorStep_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MonitorRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorState" ADD CONSTRAINT "MonitorState_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorState" ADD CONSTRAINT "MonitorState_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MonitorRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
