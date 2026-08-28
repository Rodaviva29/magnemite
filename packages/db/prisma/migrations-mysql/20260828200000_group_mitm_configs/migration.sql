-- Fleet columns move onto the group that runs the app.
--
-- A watched package was fleet-wide, which could not describe two sites running
-- two MITMs against two Rotom instances — and the config that has to be written
-- next to the MITM is per site by nature. So the package, its column header and
-- its config all live on the group now.
--
-- mitmConfig is TEXT and not VARCHAR: an aegis config is longer than 191
-- characters, which is what a bare String maps to here.
ALTER TABLE `DeviceGroup`
  ADD COLUMN `mitmPackageName` VARCHAR(191) NULL,
  ADD COLUMN `mitmLabel` VARCHAR(191) NULL,
  ADD COLUMN `mitmConfigPath` VARCHAR(191) NULL,
  ADD COLUMN `mitmConfig` TEXT NULL,
  ADD COLUMN `mitmRestartCommand` VARCHAR(191) NULL;

-- Carry today's column across, so the fleet table does not lose it on deploy.
-- A group declares one MITM, so the fleet-wide list collapses onto the first
-- watched package. A fleet watching a second one keeps its recorded versions —
-- the DevicePackage rows are untouched — but loses that column.
--
-- The derived-table wrapper is not decoration: MySQL refuses a subquery that
-- reads the table being updated, and refuses LIMIT in an IN subquery.
UPDATE `DeviceGroup` g
JOIN (
  SELECT * FROM (
    SELECT `packageName`, `label` FROM `WatchedPackage`
    ORDER BY `position` ASC, `createdAt` ASC LIMIT 1
  ) first
) w
SET g.`mitmPackageName` = w.`packageName`, g.`mitmLabel` = w.`label`
WHERE g.`mitmPackageName` IS NULL;

DROP TABLE `WatchedPackage`;

-- What the box's agent says it can be asked to do. Null on every row until each
-- box reconnects and says hello, which is the honest state: the hub has not
-- heard from them yet.
ALTER TABLE `Device` ADD COLUMN `capabilities` JSON NULL;
