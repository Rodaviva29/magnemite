-- Cheap health signals the agent reads out of /proc on each heartbeat.
ALTER TABLE "Device" ADD COLUMN "loadAvg1" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "loadAvg5" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "loadAvg15" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "cpuCount" INTEGER;
ALTER TABLE "Device" ADD COLUMN "memTotalBytes" BIGINT;
ALTER TABLE "Device" ADD COLUMN "memAvailableBytes" BIGINT;

-- Last time the agent sent a full third-party package inventory.
ALTER TABLE "Device" ADD COLUMN "packagesSyncedAt" TIMESTAMP(3);
