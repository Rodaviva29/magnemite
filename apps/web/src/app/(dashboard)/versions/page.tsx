import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
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
    return (
      <p className="text-sm text-muted-foreground">
        No app target configured. Add one from Settings.
      </p>
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
