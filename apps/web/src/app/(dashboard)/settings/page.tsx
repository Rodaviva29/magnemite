import { getHubSettings, prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { AppTargetCard, type FeedChoice } from "@/components/settings/app-target-card";
import { CreateAppTargetForm } from "@/components/settings/create-app-target-form";
import { GroupsSection } from "@/components/settings/groups-section";
import { HubSettingsForm } from "@/components/settings/hub-settings-form";
import { SettingsShell, type SettingsSection } from "@/components/settings/settings-shell";
import { SourcesSection } from "@/components/settings/sources-section";
import { WatchedPackagesSection } from "@/components/settings/watched-packages-section";
import { EnrollmentSection } from "@/components/settings/enrollment-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const canOperate = user.role !== "VIEWER";

  const [hubSettings, targets, feeds, watched, deviceCount, reporting, groups, tokens] =
    await Promise.all([
      getHubSettings(),
      // Manual uploads create a target of their own to hang the artifact off.
      // Those are a record of an upload, not configuration, so settings only
      // ever deals with the watched one.
      prisma.appTarget.findMany({
        where: { manual: false },
        orderBy: { displayName: "asc" },
        include: { sources: { select: { feedId: true } } },
      }),
      prisma.sourceFeed.findMany({
        orderBy: { priority: "asc" },
        include: { _count: { select: { versions: true } } },
      }),
      prisma.watchedPackage.findMany({ orderBy: { position: "asc" } }),
      prisma.device.count({ where: { approved: true } }),
      // How many boxes have answered for each watched package, in one pass
      // rather than a count per package.
      prisma.devicePackage.groupBy({
        by: ["packageName"],
        where: { installed: true },
        _count: { _all: true },
      }),
      prisma.deviceGroup.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { devices: true } } },
      }),
      prisma.enrollmentToken.findMany({ orderBy: { createdAt: "desc" } }),
    ]);

  const publicUrl = process.env.MAGNEMITE_PUBLIC_URL ?? "https://your.host";
  const reportingCounts = new Map(reporting.map((row) => [row.packageName, row._count._all]));
  // Which targets each feed serves, and which of them it is the only source
  // for. Removing a feed unpairs it everywhere, and a target left with none is
  // never polled again — the sources section warns about exactly that.
  const targetsByFeed = new Map<string, string[]>();
  const soleSourceByFeed = new Map<string, string[]>();
  for (const target of targets) {
    for (const link of target.sources) {
      targetsByFeed.set(link.feedId, [
        ...(targetsByFeed.get(link.feedId) ?? []),
        target.displayName,
      ]);
      if (target.sources.length === 1) {
        soleSourceByFeed.set(link.feedId, [
          ...(soleSourceByFeed.get(link.feedId) ?? []),
          target.displayName,
        ]);
      }
    }
  }

  // The pickable sources, in the order the sources section lists them.
  const feedChoices: FeedChoice[] = feeds.map((feed) => ({
    id: feed.id,
    name: feed.name,
    enabled: feed.enabled,
  }));

  // Everything is still fetched in the one pass above — the shell only decides
  // which of these is on screen, so switching category costs no round trip.
  const sections: SettingsSection[] = [
    {
      id: "hub",
      content: <HubSettingsForm settings={hubSettings} disabled={!canOperate} />,
    },
    {
      id: "apps",
      count: targets.length,
      content: (
        <>
          {/* Nothing configured yet, but the card still shows what a target
              gets you — greyed out and unsubmittable — so the tab reads as a
              place waiting to be filled rather than an empty one. */}
          {targets.length === 0 ? (
            <AppTargetCard target={null} feeds={feedChoices} disabled />
          ) : null}

          {targets.map((target) => (
            <AppTargetCard
              key={target.id}
              target={{
                id: target.id,
                displayName: target.displayName,
                packageName: target.packageName,
                autoUpdateEnabled: target.autoUpdateEnabled,
                autoApprove: target.autoApprove,
                canaryCount: target.canaryCount,
                soakMinutes: target.soakMinutes,
                maxAttempts: target.maxAttempts,
                windowStart: target.windowStart,
                windowEnd: target.windowEnd,
                sourceIds: target.sources.map((link) => link.feedId),
              }}
              feeds={feedChoices}
              disabled={!canOperate}
            />
          ))}

          {canOperate ? <CreateAppTargetForm feeds={feedChoices} /> : null}
        </>
      ),
    },
    {
      id: "sources",
      count: feeds.length,
      content: (
        <SourcesSection
          feeds={feeds.map((feed) => ({
            id: feed.id,
            name: feed.name,
            indexUrl: feed.indexUrl,
            baseUrl: feed.baseUrl,
            enabled: feed.enabled,
            priority: feed.priority,
            versionCount: feed._count.versions,
            targetCount: targetsByFeed.get(feed.id)?.length ?? 0,
            orphanedTargets: soleSourceByFeed.get(feed.id) ?? [],
          }))}
          disabled={!canOperate}
        />
      ),
    },
    {
      id: "columns",
      count: watched.length,
      content: (
        <WatchedPackagesSection
          packages={watched.map((row) => ({
            id: row.id,
            packageName: row.packageName,
            label: row.label,
            // How many boxes have answered for it, which is the difference
            // between "nothing has it installed" and "nobody has reported yet".
            reporting: reportingCounts.get(row.packageName) ?? 0,
          }))}
          deviceCount={deviceCount}
          disabled={!canOperate}
        />
      ),
    },
    {
      id: "groups",
      count: groups.length,
      content: (
        <GroupsSection
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            preInstallHook: g.preInstallHook,
            postInstallHook: g.postInstallHook,
            maxConcurrency: g.maxConcurrency,
            deviceCount: g._count.devices,
          }))}
          disabled={!canOperate}
        />
      ),
    },
    {
      id: "enrollment",
      // Revoked tokens stay in the table as history; the count is what a box
      // could still enrol with today.
      count: tokens.filter((t) => !t.revoked).length,
      content: (
        <EnrollmentSection
          tokens={tokens.map((t) => ({
            id: t.id,
            label: t.label,
            prefix: t.prefix,
            autoApprove: t.autoApprove,
            uses: t.uses,
            maxUses: t.maxUses,
            revoked: t.revoked,
            createdAt: t.createdAt.toISOString(),
          }))}
          publicUrl={publicUrl}
          disabled={!canOperate}
        />
      ),
    },
  ];

  return <SettingsShell sections={sections} />;
}
