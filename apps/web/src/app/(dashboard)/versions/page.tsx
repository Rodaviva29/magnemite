import Link from "next/link";
import { Package } from "lucide-react";
import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { compareVersions } from "@/lib/format";
import { VersionsTable, type VersionRow } from "@/components/versions-table";

export const dynamic = "force-dynamic";

export default async function VersionsPage() {
  const user = await requireUser();

  // Every watched target, not just the first one: the fleet can track several
  // apps and each has its own versions, which is what the Target column is for.
  const targets = await prisma.appTarget.findMany({
    where: { enabled: true, manual: false },
    orderBy: { displayName: "asc" },
  });

  if (targets.length === 0) {
    // A bare sentence at the top-left of an otherwise blank page read as a
    // page that had failed to load. This is the same empty state the rest of
    // the app uses, and it carries the way out rather than naming it.
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Versions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Builds discovered for the packages this fleet tracks.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Package className="h-6 w-6 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">
            No app target yet. Versions are discovered per tracked package, so nothing is polled and
            nothing appears here until one exists.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings#apps">Add an app target</Link>
          </Button>
        </div>
      </div>
    );
  }

  const targetIds = targets.map((t) => t.id);
  const packageNames = targets.map((t) => t.packageName);

  const [versions, installed] = await Promise.all([
    prisma.appVersion.findMany({
      where: { appTargetId: { in: targetIds } },
      orderBy: { discoveredAt: "desc" },
      include: {
        feed: { select: { name: true } },
        appTarget: { select: { displayName: true, packageName: true } },
      },
    }),
    // One pass for every watched package rather than a query each: the count
    // is per (package, version), since two apps can share a version string.
    prisma.devicePackage.groupBy({
      by: ["packageName", "versionName"],
      where: { packageName: { in: packageNames }, device: { approved: true } },
      _count: { _all: true },
    }),
  ]);

  const installCounts = new Map(
    installed.map((row) => [`${row.packageName}|${row.versionName ?? ""}`, row._count._all]),
  );

  const rows: VersionRow[] = versions
    // Grouped by app, newest build first inside each — the same order the
    // Target column sorts by, so the default view already reads that way.
    .sort(
      (a, b) =>
        a.appTarget.displayName.localeCompare(b.appTarget.displayName) ||
        compareVersions(b.version, a.version),
    )
    .map((v) => ({
      id: v.id,
      targetName: v.appTarget.displayName,
      targetPackage: v.appTarget.packageName,
      version: v.version,
      buildCode: v.buildCode,
      source: v.source,
      feedName: v.feed?.name ?? null,
      remoteUrl: v.remoteUrl,
      arch: v.arch,
      status: v.status,
      cacheProgress: v.cacheProgress,
      sizeBytes: Number(v.sizeBytes),
      approved: v.approved,
      sha256: v.sha256,
      error: v.error,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      discoveredAt: v.discoveredAt.toISOString(),
      devicesOnThis: installCounts.get(`${v.appTarget.packageName}|${v.version}`) ?? 0,
    }));

  return (
    <VersionsTable rows={rows} targetCount={targets.length} canOperate={user.role !== "VIEWER"} />
  );
}
