import { Fragment } from "react";
import { getHubSettings, getMonitorSettings, prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { AppTargetCard, type FeedChoice } from "@/components/settings/app-target-card";
import { MonitoringSection, type MonitorRuleRow } from "@/components/settings/monitoring-section";
import { CreateAppTargetForm } from "@/components/settings/create-app-target-form";
import { GroupsSection } from "@/components/settings/groups-section";
import { HubSettingsForm } from "@/components/settings/hub-settings-form";
import { MonitorDiscordCard, MonitorTuningCard } from "@/components/settings/monitor-tuning-cards";
import { SettingsShell, type SettingsSection } from "@/components/settings/settings-shell";
import { SourcesSection } from "@/components/settings/sources-section";
import { WatchedPackagesSection } from "@/components/settings/watched-packages-section";
import { EnrollmentSection } from "@/components/settings/enrollment-section";

export const dynamic = "force-dynamic";

/**
 * The probe out of a rule's `config` JSON.
 *
 * Defensive rather than trusting: this is operator input that has been through
 * a JSON column, and a rule with a malformed probe should render as one
 * without a probe rather than throwing the whole settings page.
 */
function readProbe(config: unknown): MonitorRuleRow["probe"] {
  const probe = (config as { probe?: Record<string, unknown> } | null)?.probe;
  if (!probe || typeof probe.target !== "string" || typeof probe.kind !== "string") return null;

  const num = (value: unknown, fallback: number | null) =>
    typeof value === "number" ? value : fallback;

  return {
    kind: probe.kind,
    target: probe.target,
    expect: typeof probe.expect === "string" ? probe.expect : null,
    lines: num(probe.lines, 200) ?? 200,
    failAt: num(probe.failAt, 1) ?? 1,
    successPattern: typeof probe.successPattern === "string" ? probe.successPattern : null,
    maxRatio: num(probe.maxRatio, null),
    maxAgeSeconds: num(probe.maxAgeSeconds, null),
    timeoutSeconds: num(probe.timeoutSeconds, 10) ?? 10,
  };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const canOperate = user.role !== "VIEWER";

  const [
    hubSettings,
    monitorSettings,
    monitorRules,
    monitorCapable,
    targets,
    feeds,
    watched,
    deviceCount,
    reporting,
    groups,
    tokens,
  ] = await Promise.all([
    getHubSettings(),
    getMonitorSettings(),
    prisma.monitorRule.findMany({
      orderBy: { position: "asc" },
      include: { steps: { orderBy: { atFailure: "asc" } } },
    }),
    // Boxes on an agent new enough to run the probes. A rule that appears to
    // do nothing is usually this, so the tab says it rather than leaving it
    // to be worked out.
    prisma.device.count({ where: { approved: true, monitorReportedAt: { not: null } } }),
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
      id: "tuning",
      content: (
        <Fragment key="tuning">
          <HubSettingsForm settings={hubSettings} disabled={!canOperate} />
          {/* The monitoring knobs sit here rather than beside the rules: every
              one of them is measured against the heartbeat or the offline
              timeout in the card above, and a tab away each coupling had to be
              restated in a hint instead of being visible. */}
          <MonitorTuningCard settings={monitorSettings} disabled={!canOperate} />
          <MonitorDiscordCard settings={monitorSettings} disabled={!canOperate} />
        </Fragment>
      ),
    },
    {
      id: "monitoring",
      count: monitorRules.filter((rule) => rule.enabled).length,
      content: (
        <MonitoringSection
          key="monitoring"
          settings={monitorSettings}
          rules={monitorRules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            signal: rule.signal,
            packageName: rule.packageName,
            groupId: rule.groupId,
            threshold: rule.threshold,
            cooldownSeconds: rule.cooldownSeconds,
            windowStart: rule.windowStart,
            windowEnd: rule.windowEnd,
            notifyLevel: rule.notifyLevel,
            notify: rule.notify,
            // The probe half of the config, read defensively: it is operator
            // input that has been through a JSON column.
            probe: readProbe(rule.config),
            steps: rule.steps.map((step) => ({
              atFailure: step.atFailure,
              action: step.action,
              command: step.command,
            })),
          }))}
          groups={groups.map((group) => ({ id: group.id, name: group.name }))}
          deviceCount={deviceCount}
          capableCount={monitorCapable}
          disabled={!canOperate}
        />
      ),
    },
    {
      id: "apps",
      count: targets.length,
      content: (
        <Fragment key="apps">
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
                retryBackoffSeconds: target.retryBackoffSeconds,
                updateCooldownMinutes: target.updateCooldownMinutes,
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
        </Fragment>
      ),
    },
    {
      id: "sources",
      count: feeds.length,
      content: (
        <SourcesSection
          key="sources"
          feeds={feeds.map((feed) => ({
            id: feed.id,
            name: feed.name,
            indexUrl: feed.indexUrl,
            baseUrl: feed.baseUrl,
            enabled: feed.enabled,
            priority: feed.priority,
            pollMinutes: feed.pollMinutes,
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
          key="columns"
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
          key="groups"
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
          key="enrollment"
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
