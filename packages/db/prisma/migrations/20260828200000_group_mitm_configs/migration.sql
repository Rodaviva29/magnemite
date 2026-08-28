-- Fleet columns move onto the group that runs the app.
--
-- A watched package was fleet-wide, which could not describe two sites running
-- two MITMs against two Rotom instances — and the config that has to be written
-- next to the MITM is per site by nature. So the package, its column header and
-- its config all live on the group now.
ALTER TABLE "DeviceGroup" ADD COLUMN "mitmPackageName" TEXT;
ALTER TABLE "DeviceGroup" ADD COLUMN "mitmLabel" TEXT;
ALTER TABLE "DeviceGroup" ADD COLUMN "mitmConfigPath" TEXT;
ALTER TABLE "DeviceGroup" ADD COLUMN "mitmConfig" TEXT;
ALTER TABLE "DeviceGroup" ADD COLUMN "mitmRestartCommand" TEXT;

-- Carry today's column across, so the fleet table does not lose it on deploy.
-- A group declares one MITM, so the fleet-wide list collapses onto the first
-- watched package. A fleet watching a second one keeps its recorded versions —
-- the DevicePackage rows are untouched — but loses that column.
UPDATE "DeviceGroup" g
SET "mitmPackageName" = w."packageName", "mitmLabel" = w."label"
FROM (
  SELECT "packageName", "label" FROM "WatchedPackage"
  ORDER BY "position" ASC, "createdAt" ASC LIMIT 1
) w
WHERE g."mitmPackageName" IS NULL;

DROP TABLE "WatchedPackage";

-- What the box's agent says it can be asked to do. Null on every row until each
-- box reconnects and says hello, which is the honest state: the hub has not
-- heard from them yet.
ALTER TABLE "Device" ADD COLUMN "capabilities" JSONB;
