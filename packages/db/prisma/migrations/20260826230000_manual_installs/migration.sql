-- Targets created by a manual upload: no source to poll, no auto-update policy.
ALTER TABLE "AppTarget" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;

-- Per-rollout install hooks, overriding the device group's own.
ALTER TABLE "Rollout" ADD COLUMN "preInstallHook" TEXT;
ALTER TABLE "Rollout" ADD COLUMN "postInstallHook" TEXT;
