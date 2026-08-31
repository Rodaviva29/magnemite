-- Rotom history: what Rotom said about a box over time, so the device page can
-- draw it rather than only state it.
--
-- Its own table rather than columns on DeviceMetricSample, because the writers
-- and cadences differ: a metric sample is cut from a heartbeat, this is cut
-- from the Rotom sync. That is also the point — a box whose agent has died
-- sends no heartbeat, and those are the minutes where what Rotom still sees
-- matters most.
--
-- It is pruned by the same `metricsRetentionDays` as the metric samples, which
-- is why it carries the same pair of indexes: one for the chart's per-device
-- window, one for the fleet-wide prune.

-- CreateTable
CREATE TABLE "RotomSample" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "canBeUsed" BOOLEAN NOT NULL,
    "inUse" BOOLEAN NOT NULL,
    "workerCount" INTEGER,
    "workersInUse" INTEGER,
    "requestRate" DOUBLE PRECISION,

    CONSTRAINT "RotomSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RotomSample_deviceId_at_idx" ON "RotomSample"("deviceId", "at");

-- CreateIndex
CREATE INDEX "RotomSample_at_idx" ON "RotomSample"("at");

-- AddForeignKey
ALTER TABLE "RotomSample" ADD CONSTRAINT "RotomSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
