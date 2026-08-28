-- Two settings that were fleet-wide move onto the rows they were always about:
-- how often an index is read belongs to the feed, and how long to wait between
-- automatic rollouts belongs to the app.
ALTER TABLE "SourceFeed" ADD COLUMN "pollMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "AppTarget" ADD COLUMN "updateCooldownMinutes" INTEGER NOT NULL DEFAULT 0;

-- Carry whatever the fleet had set onto every existing row, so upgrading does
-- not quietly reset a deliberately slow poll back to the default. The regex is
-- the guard: `Setting.value` is JSON and anything that is not a plain number
-- leaves the column on its default rather than failing the migration.
UPDATE "SourceFeed" SET "pollMinutes" = s.v
FROM (
  SELECT ("value" #>> '{}')::int AS v
  FROM "Setting"
  WHERE "key" = 'sourcePollMinutes' AND ("value" #>> '{}') ~ '^[0-9]+$'
) s
WHERE s.v >= 1;

UPDATE "AppTarget" SET "updateCooldownMinutes" = s.v
FROM (
  SELECT ("value" #>> '{}')::int AS v
  FROM "Setting"
  WHERE "key" = 'updateCooldownMinutes' AND ("value" #>> '{}') ~ '^[0-9]+$'
) s
WHERE s.v >= 0;

-- The old rows are left where they are. `getHubSettings` only reads the keys it
-- has defaults for, so they are inert, and keeping them means a rollback finds
-- its values still there.
