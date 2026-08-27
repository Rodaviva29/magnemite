-- Log bundles: one row per "fetch me this box's logs" request. The zip lives
-- on the artifacts volume; this is the request, so a bundle that never arrived
-- shows as a failure instead of a download that does nothing.

-- CreateEnum
CREATE TYPE "DeviceLogBundleState" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "DeviceLogBundle" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "state" "DeviceLogBundleState" NOT NULL DEFAULT 'PENDING',
    "path" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceLogBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceLogBundle_deviceId_requestedAt_idx" ON "DeviceLogBundle"("deviceId", "requestedAt");

-- AddForeignKey
ALTER TABLE "DeviceLogBundle" ADD CONSTRAINT "DeviceLogBundle_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
