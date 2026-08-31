"use client";

import { useActionState, useState, useTransition } from "react";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { CONFIG_PLACEHOLDERS } from "@/lib/config-placeholders";
import { createGroup, deleteGroup, updateGroup } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { RenameDevicesDialog } from "@/components/rename-devices-dialog";

export type GroupRow = {
  id: string;
  name: string;
  preInstallHook: string | null;
  postInstallHook: string | null;
  maxConcurrency: number | null;
  deviceCount: number;
  /**
   * Approved boxes only — the ones a rollout can actually reach, and so the
   * honest denominator for "N of M reporting". `deviceCount` counts every
   * enrolled box, pending ones included, which is the right number for
   * "N devices will lose this group" and the wrong one here.
   */
  approvedCount: number;
  mitmPackageName: string | null;
  mitmLabel: string | null;
  mitmConfigPath: string | null;
  /** Null for a VIEWER even when one is set — it holds bearer tokens. */
  mitmConfig: string | null;
  /** So a VIEWER can still be told one exists without being shown it. */
  hasMitmConfig: boolean;
  /**
   * How many of *this group's* approved boxes have reported a version for its
   * MITM. Per group, so it can be read against `approvedCount` below it.
   */
  reporting: number;
};

/**
 * The shapes aconf uses, so nobody has to type them from memory.
 *
 * These are the MITMs this fleet actually runs, and their config keys are not
 * guessable — `rotomUrl` on one is `rdmUrl` on the next, GoCheats uses
 * snake_case and a plain `config.json`, and Cosmog wants two endpoints where
 * the others want one. Getting a key wrong is a scanner that starts and does
 * nothing.
 */
const PRESETS = [
  {
    id: "aegis",
    label: "Aegis",
    packageName: "com.pokemod.aegis",
    configPath: "/data/local/tmp/aegis_config.json",
    config: `{
  "authBearer": "YOUR_ROTOM_SECRET",
  "deviceAuthToken": "YOUR_AEGIS_AUTH_TOKEN",
  "deviceName": "{{device.name}}",
  "email": "YOUR_AEGIS_REGISTRATION_EMAIL",
  "rotomUrl": "http://YOUR_ROTOM_URL:7072",
  "runOnBoot": true,
  "workers": 8
}`,
  },
  {
    id: "atlas",
    label: "Atlas",
    packageName: "com.pokemod.atlas",
    configPath: "/data/local/tmp/atlas_config.json",
    config: `{
  "authBearer": "YOUR_RDM_SECRET",
  "deviceAuthToken": "YOUR_ATLAS_AUTH_TOKEN",
  "deviceName": "{{device.name}}",
  "email": "YOUR_ATLAS_REGISTRATION_EMAIL",
  "rdmUrl": "http://YOUR_RDM_URL:9001",
  "ptcAuthUrl": "user:pass@sub.dom.de",
  "runOnBoot": true
}`,
  },
  {
    id: "gocheats",
    label: "GoCheats",
    packageName: "com.gocheats.launcher",
    configPath: "/data/local/tmp/config.json",
    config: `{
  "api_key": "YOUR_EXEGGCUTE_API_KEY",
  "device_name": "{{device.name}}",
  "rotom_url": "ws://YOUR_ROTOM_URL:7070",
  "rotom_secret": "YOUR_ROTOM_SECRET",
  "workers_count": 8,
  "remote_attestations": false
}`,
  },
  {
    id: "cosmog",
    label: "Cosmog",
    packageName: "com.sy1vi3.cosmog",
    configPath: "/data/local/tmp/cosmog.json",
    // Two endpoints, not one: the worker socket and the control socket are
    // separate in Cosmog, and the control one is what Rotom's restart, reboot
    // and disconnect actions travel down. A config with only the first gives a
    // box that scans and cannot be told anything.
    //
    // `device_id` is what Rotom registers the box under, so it is the string
    // Magnemite matches on — see the matching rules in the Rotom docs. Setting
    // it to anything but the device name is how a box ends up scanning fine
    // with an empty Scanner column.
    config: `{
  "device_id": "{{device.name}}",
  "rotom_worker_endpoint": "wss://YOUR_ROTOM_URL:7070",
  "rotom_device_endpoint": "wss://YOUR_ROTOM_URL:7070/control",
  "rotom_secret": "YOUR_ROTOM_SECRET",
  "token": "YOUR_COSMOG_TOKEN",
  "public_ip": "{{device.publicIp}}",
  "use_local_safetynet": true,
  "workers": 8,
  "injection_delay_ms": 5000,
  "pogo_heartbeat_timeout_ms": 30000,
  "concurrent_login_override": 0,
  "worker_spawn_delay_override": 12500,
  "disable_attest_delay": false
}`,
  },
] as const;

export function GroupsSection({ groups, disabled }: { groups: GroupRow[]; disabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          Device groups
        </CardTitle>
        <CardDescription>
          A group is a site: the hooks that run around an install, how many of its boxes may
          download at once, and the MITM they run — which is also where that MITM&apos;s config file
          lives, because two sites on two Rotom instances need two of them.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No groups yet. A box enrolling with none configured lands in a group named "default",
            created automatically.
          </p>
        ) : null}

        {groups.map((group) => (
          <GroupForm key={group.id} group={group} disabled={disabled} />
        ))}

        {!disabled ? <CreateGroupForm /> : null}
      </CardContent>
    </Card>
  );
}

function GroupForm({ group, disabled }: { group: GroupRow; disabled: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateGroup, {});
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Controlled only so the presets can fill them. A preset that could not
  // overwrite what is in the box would be a preset nobody uses twice.
  const [mitmPackageName, setMitmPackageName] = useState(group.mitmPackageName ?? "");
  const [mitmConfigPath, setMitmConfigPath] = useState(group.mitmConfigPath ?? "");
  const [mitmConfig, setMitmConfig] = useState(group.mitmConfig ?? "");

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setMitmPackageName(preset.packageName);
    setMitmConfigPath(preset.configPath);
    setMitmConfig(preset.config);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <input type="hidden" name="groupId" value={group.id} />

      <div className="flex items-center justify-between">
        <h3 className="font-medium">{group.name}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {group.deviceCount} device{group.deviceCount === 1 ? "" : "s"}
          </span>
          {!disabled && group.approvedCount > 0 ? (
            // `type="button"`, or it submits the group's settings form around it.
            <RenameDevicesDialog
              source={{ groupId: group.id }}
              // No table here, so there is no order on screen to inherit.
              orders={["serial", "name", "created"]}
              trigger={
                <Button type="button" variant="outline" size="sm" disabled={pending}>
                  <Pencil className="h-4 w-4" />
                  Rename boxes
                </Button>
              }
            />
          ) : null}
          {!disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`pre-${group.id}`}>Pre-install hook</Label>
          <Textarea
            id={`pre-${group.id}`}
            name="preInstallHook"
            defaultValue={group.preInstallHook ?? ""}
            placeholder="am force-stop com.nianticlabs.pokemongo"
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`post-${group.id}`}>Post-install hook</Label>
          <Textarea
            id={`post-${group.id}`}
            name="postInstallHook"
            defaultValue={group.postInstallHook ?? ""}
            placeholder="monkey -p com.nianticlabs.pokemongo 1"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:max-w-64">
        <Label htmlFor={`conc-${group.id}`}>Concurrent updates in this group</Label>
        <Input
          id={`conc-${group.id}`}
          name="maxConcurrency"
          type="number"
          min={1}
          placeholder="no limit"
          defaultValue={group.maxConcurrency ?? ""}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          For a site on a thin uplink: caps how many of its boxes download at once, under this
          fleet.
        </p>
      </div>

      {/* --- MITM data ---------------------------------------------------- */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-medium">MITM data</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The scanner these boxes run. Magnemite installs it and writes the config below;
              nothing polls a feed for it, so its version is reported rather than tracked.
            </p>
          </div>
          {!disabled ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Fill from</span>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`mitm-pkg-${group.id}`}>MITM package</Label>
            <Input
              id={`mitm-pkg-${group.id}`}
              name="mitmPackageName"
              value={mitmPackageName}
              onChange={(e) => setMitmPackageName(e.target.value)}
              placeholder="com.pokemod.aegis"
              className="font-mono text-xs"
              disabled={disabled}
            />
            {group.mitmPackageName ? (
              <p className="text-xs text-muted-foreground">
                {group.reporting} of {group.approvedCount} box
                {group.approvedCount === 1 ? "" : "es"} in this group reporting a version
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`mitm-label-${group.id}`}>Column header</Label>
            <Input
              id={`mitm-label-${group.id}`}
              name="mitmLabel"
              defaultValue={group.mitmLabel ?? ""}
              placeholder="aegis"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`mitm-path-${group.id}`}>Config file path</Label>
          <Input
            id={`mitm-path-${group.id}`}
            name="mitmConfigPath"
            value={mitmConfigPath}
            onChange={(e) => setMitmConfigPath(e.target.value)}
            placeholder="/data/local/tmp/aegis_config.json"
            className="font-mono text-xs"
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`mitm-config-${group.id}`}>Config JSON</Label>
          {disabled && group.hasMitmConfig ? (
            <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted-foreground">
              A config is set. It holds the credentials the scanner authenticates with, so only
              operators can read it.
            </p>
          ) : (
            <>
              <Textarea
                id={`mitm-config-${group.id}`}
                name="mitmConfig"
                value={mitmConfig}
                onChange={(e) => setMitmConfig(e.target.value)}
                rows={12}
                className="font-mono text-xs"
                placeholder={PRESETS[0].config}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Written to every box in this group, with{" "}
                <code className="font-mono">{"{{device.name}}"}</code> and friends replaced by that
                box&apos;s own values. Available:{" "}
                <span className="font-mono">{CONFIG_PLACEHOLDERS.join(", ")}</span>. A placeholder
                with no value on a box is refused rather than written blank.
              </p>
            </>
          )}
        </div>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      {!disabled ? (
        <div className="flex justify-end">
          <SaveButton state={state} size="sm" />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${group.name}?`}
        description={
          group.deviceCount === 0
            ? "Nothing is in this group, so nothing else changes."
            : `${group.deviceCount} device${group.deviceCount === 1 ? "" : "s"} will lose this group.`
        }
        pending={pending}
        error={removeError}
        onConfirm={() => {
          startTransition(async () => {
            const result = await deleteGroup(group.id);
            setRemoveError(result.error ?? null);
            if (!result.error) setConfirmOpen(false);
          });
        }}
      >
        {/* The devices themselves are untouched — worth saying, because
            "remove the group" reads like it might take them with it. */}
        {group.deviceCount > 0 ? (
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted-foreground">
            The devices are not deleted. They keep running and can be put in another group
            afterward; until then they have none, and fall back to the fleet-wide settings.
          </p>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

function CreateGroupForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createGroup, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-group">New group</Label>
        <Input id="new-group" name="name" placeholder="lisbon-site" className="w-56" />
      </div>
      <Button type="submit" variant="outline">
        <Plus />
        Create
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
