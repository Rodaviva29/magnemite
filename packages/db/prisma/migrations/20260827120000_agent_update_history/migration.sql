-- CreateEnum
CREATE TYPE "AgentUpdateState" AS ENUM ('SENT', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "AgentUpdate" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fromVersion" TEXT,
    "toVersion" TEXT NOT NULL,
    "state" "AgentUpdateState" NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentUpdate_deviceId_sentAt_idx" ON "AgentUpdate"("deviceId", "sentAt");

-- AddForeignKey
ALTER TABLE "AgentUpdate" ADD CONSTRAINT "AgentUpdate_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
