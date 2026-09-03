-- The all-clear, opted into per rule. A fault worth being told about is not
-- always a fault worth being told has ended, so this is off by default and
-- existing rules keep announcing only their faults.

-- AlterTable
ALTER TABLE "MonitorRule" ADD COLUMN     "notifyRecovery" BOOLEAN NOT NULL DEFAULT false;

-- The dedupe window has to ignore recoveries in both directions: one must not
-- be swallowed by the fault it ends, nor swallow the next fault, and
-- neither the level nor the message is a reliable way to spot one.

-- AlterTable
ALTER TABLE "MonitorEvent" ADD COLUMN     "recovery" BOOLEAN NOT NULL DEFAULT false;
