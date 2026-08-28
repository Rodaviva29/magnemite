-- Health history for the /devices/[id]/metrics charts, plus the thermal
-- readings the agent now gathers.
--
-- Two tables rather than one wide one: an app that is not running has no
-- per-package row at all, which is what makes "the scanner was dead from 3am"
-- read as a gap rather than as a flat zero. Both are pruned by the hub against
-- the metricsRetentionDays setting.

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "batteryTempC" DOUBLE PRECISION,
ADD COLUMN     "cpuTempC" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DeviceMetricSample" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadAvg1" DOUBLE PRECISION,
    "loadAvg5" DOUBLE PRECISION,
    "loadAvg15" DOUBLE PRECISION,
    "cpuCount" INTEGER,
    "memTotalBytes" BIGINT,
    "memAvailableBytes" BIGINT,
    "freeBytes" BIGINT,
    "totalBytes" BIGINT,
    "cpuTempC" DOUBLE PRECISION,
    "batteryTempC" DOUBLE PRECISION,

    CONSTRAINT "DeviceMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePackageMetricSample" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPercent" DOUBLE PRECISION,
    "rssBytes" BIGINT,
    "processCount" INTEGER,

    CONSTRAINT "DevicePackageMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceMetricSample_deviceId_at_idx" ON "DeviceMetricSample"("deviceId", "at");

-- CreateIndex
CREATE INDEX "DeviceMetricSample_at_idx" ON "DeviceMetricSample"("at");

-- CreateIndex
CREATE INDEX "DevicePackageMetricSample_deviceId_at_idx" ON "DevicePackageMetricSample"("deviceId", "at");

-- CreateIndex
CREATE INDEX "DevicePackageMetricSample_deviceId_packageName_at_idx" ON "DevicePackageMetricSample"("deviceId", "packageName", "at");

-- CreateIndex
CREATE INDEX "DevicePackageMetricSample_at_idx" ON "DevicePackageMetricSample"("at");

-- AddForeignKey
ALTER TABLE "DeviceMetricSample" ADD CONSTRAINT "DeviceMetricSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePackageMetricSample" ADD CONSTRAINT "DevicePackageMetricSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
