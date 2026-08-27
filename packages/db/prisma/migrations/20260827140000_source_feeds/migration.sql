-- Source feeds replace the two hard-coded integrations.
--
-- Both places Magnemite watched published the same flat JSON index; only the
-- GitHub one was read through the releases API instead. Feeds make that a row
-- rather than code, so a compatible index can be added from Settings.

-- CreateTable
CREATE TABLE "SourceFeed" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "indexUrl" TEXT NOT NULL,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceFeed_name_key" ON "SourceFeed"("name");

-- The two feeds this deployment already watched, with fixed ids so the data
-- migration below can point rows at them.
INSERT INTO "SourceFeed" ("id", "name", "indexUrl", "baseUrl", "enabled", "priority", "updatedAt")
VALUES
    ('feed_unown_mirror', 'UnownHash mirror', 'https://mirror.unownhash.com/index.json', 'https://mirror.unownhash.com/', true, 100, CURRENT_TIMESTAMP),
    ('feed_silva', 'Silva (The Treeline Project)', 'https://the-treeline-project.github.io/p/silva/index.json', NULL, true, 200, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "AppVersion" ADD COLUMN "feedId" TEXT;

-- Point existing rows at the feed they came from.
UPDATE "AppVersion" SET "feedId" = 'feed_unown_mirror' WHERE "source" = 'MIRROR';
UPDATE "AppVersion" SET "feedId" = 'feed_silva' WHERE "source" = 'GITHUB';

-- A build is now stored once, whichever feed listed it. Where both feeds
-- produced a row for the same build, keep one and move any rollouts onto it:
-- READY wins (its .apkm is already cached), then the oldest row.
WITH ranked AS (
    SELECT
        "id",
        FIRST_VALUE("id") OVER (
            PARTITION BY "appTargetId", "version", "arch"
            ORDER BY ("status" = 'READY') DESC, "discoveredAt" ASC, "id" ASC
        ) AS keep_id
    FROM "AppVersion"
)
UPDATE "Rollout" r
SET "appVersionId" = ranked.keep_id
FROM ranked
WHERE r."appVersionId" = ranked."id" AND ranked."id" <> ranked.keep_id;

WITH ranked AS (
    SELECT
        "id",
        FIRST_VALUE("id") OVER (
            PARTITION BY "appTargetId", "version", "arch"
            ORDER BY ("status" = 'READY') DESC, "discoveredAt" ASC, "id" ASC
        ) AS keep_id
    FROM "AppVersion"
)
DELETE FROM "AppVersion" v
USING ranked
WHERE v."id" = ranked."id" AND ranked."id" <> ranked.keep_id;

-- AddForeignKey
ALTER TABLE "AppVersion" ADD CONSTRAINT "AppVersion_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "SourceFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "AppVersion_appTargetId_source_version_arch_key";

-- CreateIndex
CREATE UNIQUE INDEX "AppVersion_appTargetId_version_arch_key" ON "AppVersion"("appTargetId", "version", "arch");

-- Everything polled is a feed now, so GITHUB leaves the enum.
UPDATE "AppVersion" SET "source" = 'MIRROR' WHERE "source" = 'GITHUB';
ALTER TABLE "AppTarget" ALTER COLUMN "preferredSource" DROP DEFAULT;

CREATE TYPE "VersionSource_new" AS ENUM ('MIRROR', 'MANUAL');
ALTER TABLE "AppVersion" ALTER COLUMN "source" TYPE "VersionSource_new" USING ("source"::text::"VersionSource_new");
ALTER TABLE "AppTarget" ALTER COLUMN "preferredSource" TYPE "VersionSource_new" USING ("preferredSource"::text::"VersionSource_new");
DROP TYPE "VersionSource";
ALTER TYPE "VersionSource_new" RENAME TO "VersionSource";

-- AlterTable: per-target source configuration is gone.
ALTER TABLE "AppTarget"
    DROP COLUMN "githubRepo",
    DROP COLUMN "assetPattern",
    DROP COLUMN "mirrorIndexUrl",
    DROP COLUMN "mirrorBaseUrl",
    DROP COLUMN "preferredSource";
