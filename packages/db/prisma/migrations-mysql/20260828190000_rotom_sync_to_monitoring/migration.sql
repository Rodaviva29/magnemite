-- The Rotom sync interval moves from the hub group to the monitoring one. It is
-- read by the monitor, and the stale delay it is measured against already lives
-- there, so keeping the two in separate forms only made the coupling harder to
-- honour. Groups are a key prefix in this table, so the move is a rename.
UPDATE `Setting` SET `key` = 'monitor.rotomSyncSeconds'
WHERE `key` = 'rotomSyncSeconds'
  AND NOT EXISTS (SELECT 1 FROM (SELECT `key` FROM `Setting`) s WHERE s.`key` = 'monitor.rotomSyncSeconds');

-- Only reachable when both keys somehow existed; the unprefixed one is the
-- stale copy either way.
DELETE FROM `Setting` WHERE `key` = 'rotomSyncSeconds';
