import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { compareVersions } from "@/lib/format";
import { VersionsTable, type VersionRow } from "@/components/versions-table";

export const dynamic = "force-dynamic";

export default async function VersionsPage() {
  const user = await requireUser();

  const target = await prisma.appTarget.findFirst({ where: { enabled: true, manual: false } });
  if (!target) {
    return (
      <p className="text-sm text-muted-foreground">
        No app target configured. Add one from Settings.
      </p>
    );
  }

  const [versions, installed] = await Promise.all([
    prisma.appVersion.findMany({
      where: { appTargetId: target.id },
      orderBy: { discoveredAt: "desc" },
      include: { feed: { select: { name: true } } },
    }),
    prisma.devicePackage.groupBy({
      by: ["versionName"],
      where: { packageName: target.packageName, device: { approved: true } },
      _count: { _all: true },
    }),
  ]);

  const installCounts = new Map(
    installed.map((row) => [row.versionName ?? "", row._count._all] as const),
  );

  const rows: VersionRow[] = versions
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((v) => ({
      id: v.id,
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
      devicesOnThis: installCounts.get(v.version) ?? 0,
    }));

  return (
    <VersionsTable
      rows={rows}
      packageName={target.packageName}
      canOperate={user.role !== "VIEWER"}
    />
  );
}
