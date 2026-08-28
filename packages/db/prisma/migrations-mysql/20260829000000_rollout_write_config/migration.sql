-- Let one deploy leave the MITM config alone.
--
-- A deploy of a group's own MITM carries that group's config, and the package
-- match is the only gate. That is right for the deploy that configures a box
-- and wrong for the one that must not touch it: reinstalling the scanner after
-- a crash, rolling a build back, shipping a hotfix over a config somebody
-- edited on the box by hand.
ALTER TABLE `Rollout` ADD COLUMN `writeConfig` BOOLEAN NOT NULL DEFAULT true;
