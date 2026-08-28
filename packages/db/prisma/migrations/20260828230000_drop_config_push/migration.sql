-- The standalone config push is gone, and with it the restart command.
--
-- A config reached a box two ways: attached to an install of the group's MITM,
-- and pushed on its own from the settings form. The push needed a restart
-- command, because writing a file a running process has already read changes
-- nothing on its own. Inside an install the post-install hook already restarts
-- the scanner, so the command only ever earned its keep on the push path —
-- and the two were kept or dropped together.
ALTER TABLE "DeviceGroup" DROP COLUMN "mitmRestartCommand";

-- Which of the resolved hooks a rollout may run.
--
-- A null preInstallHook already means "fall back to the group", so there was
-- no way to say "run neither" — which is what the first deploy onto bare boxes
-- needs: nothing is installed yet, so there is nothing to stop and nothing to
-- start.
CREATE TYPE "RolloutHookMode" AS ENUM ('NORMAL', 'POST_ONLY', 'NONE');
ALTER TABLE "Rollout" ADD COLUMN "hookMode" "RolloutHookMode" NOT NULL DEFAULT 'NORMAL';
