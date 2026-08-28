-- Hold a failed job before its next attempt, instead of re-queueing it onto
-- the very next scheduler tick.
ALTER TABLE "AppTarget" ADD COLUMN "retryBackoffSeconds" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Rollout" ADD COLUMN "retryBackoffSeconds" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Job" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "Job_state_nextAttemptAt_idx" ON "Job"("state", "nextAttemptAt");
