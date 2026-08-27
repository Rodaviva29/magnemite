import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import {
  ManualInstall,
  type FleetPackage,
  type ManualBuild,
  type ManualDevice,
} from "@/components/manual-install";

export const dynamic = "force-dynamic";

export default async function ManualPage() {
  const user = await requireUser();
  const canOperate = user.role !== "VIEWER";

  const [devices, groups, targets, builds, packageCounts] = await Promise.all([
    prisma.device.findMany({
      where: { approved: true },
      include: {
        group: { select: { id: true, name: true } },
        packages: { select: { packageName: true, versionName: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.deviceGroup.findMany({ orderBy: { name: "asc" } }),
    prisma.appTarget.findMany({ orderBy: { displayName: "asc" } }),
    prisma.appVersion.findMany({
      where: { source: "MANUAL" },
      include: { appTarget: { select: { packageName: true, displayName: true } } },
      orderBy: { discoveredAt: "desc" },
      take: 100,
    }),
    // What the boxes actually report having installed. The agent only reports
    // the packages the hub tracks, so this lists the watched app plus anything
    // that has been uploaded here before — and a package nobody has yet is
    // still reachable by typing its name.
    prisma.devicePackage.groupBy({
      by: ["packageName"],
      where: { installed: true, device: { approved: true } },
      _count: { _all: true },
    }),
  ]);

  const displayNames = new Map(targets.map((t) => [t.packageName, t.displayName]));

  const packages: FleetPackage[] = packageCounts
    .map((row) => ({
      packageName: row.packageName,
      displayName: displayNames.get(row.packageName) ?? null,
      devices: row._count._all,
    }))
    .sort((a, b) => b.devices - a.devices || a.packageName.localeCompare(b.packageName));

  // Targets with no install reported yet still belong in the picker.
  for (const target of targets) {
    if (!packages.some((p) => p.packageName === target.packageName)) {
      packages.push({
        packageName: target.packageName,
        displayName: target.displayName,
        devices: 0,
      });
    }
  }

  const deviceRows: ManualDevice[] = devices.map((device) => ({
    id: device.id,
    name: device.name,
    serial: device.serial,
    online: device.status === "ONLINE",
    groupId: device.group?.id ?? null,
    groupName: device.group?.name ?? null,
    model: [device.manufacturer, device.model].filter(Boolean).join(" ") || null,
    androidVersion: device.androidVersion,
    freeBytes: device.freeBytes === null ? null : Number(device.freeBytes),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    installed: Object.fromEntries(
      device.packages
        .filter((p) => p.versionName)
        .map((p) => [p.packageName, p.versionName as string]),
    ),
  }));

  const buildRows: ManualBuild[] = builds.map((build) => ({
    id: build.id,
    packageName: build.appTarget.packageName,
    displayName: build.appTarget.displayName,
    version: build.version,
    arch: build.arch,
    sizeBytes: Number(build.sizeBytes),
    sha256: build.sha256,
    uploadedAt: build.discoveredAt.toISOString(),
  }));

  return (
    <ManualInstall
      packages={packages}
      devices={deviceRows}
      groups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        preInstallHook: g.preInstallHook,
        postInstallHook: g.postInstallHook,
      }))}
      builds={buildRows}
      canOperate={canOperate}
    />
  );
}
