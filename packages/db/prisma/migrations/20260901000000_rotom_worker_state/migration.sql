-- Rotom worker state: what the box is actually doing, not just whether it is
-- connected.
--
-- Every new column is nullable and every new enum value is unused until a rule
-- names it, so this migration changes nothing about a running fleet. The three
-- stat columns are null rather than zero on purpose: Rotom only measures
-- request rates in `requests` mode, or `proxy` mode with `inspect`, and a Rotom
-- that does not measure has to read as unknown. Zero there would mean every box
-- on a non-measuring Rotom looks idle.

-- AlterEnum
ALTER TYPE "MonitorSignal" ADD VALUE 'ROTOM_NOT_SCANNING';
ALTER TYPE "MonitorSignal" ADD VALUE 'ROTOM_IDLE';

-- AlterEnum
ALTER TYPE "MonitorAction" ADD VALUE 'ROTOM_DISCONNECT';
ALTER TYPE "MonitorAction" ADD VALUE 'ROTOM_REBOOT';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "rotomWorkersInUse" INTEGER,
ADD COLUMN     "rotomInUse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotomVersion" TEXT,
ADD COLUMN     "rotomRequestRate" DOUBLE PRECISION,
ADD COLUMN     "rotomRequestMs" DOUBLE PRECISION,
ADD COLUMN     "rotomStatWorkers" INTEGER;
