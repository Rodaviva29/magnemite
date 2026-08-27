-- Packages the fleet table shows a version column for. Magnemite does not
-- update these — it only asks each box what it has — which is what makes them
-- different from an AppTarget.

-- CreateTable
CREATE TABLE "WatchedPackage" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedPackage_packageName_key" ON "WatchedPackage"("packageName");
