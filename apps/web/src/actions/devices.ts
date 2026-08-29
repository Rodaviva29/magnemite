"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import {
  planFromNames,
  planRename,
  type RenameOptions,
  type RenameTarget,
} from "@/lib/rename-pattern";
import type { ActionState } from "./rollouts";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function setDeviceApproval(deviceId: string, approved: boolean): Promise<ActionState> {
  const user = await requireOperator();
  await prisma.device.update({ where: { id: deviceId }, data: { approved } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: approved ? "device.approve" : "device.unapprove",
      targetType: "Device",
      targetId: deviceId,
    },
  });
  revalidatePath("/");
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true };
}

/**
 * Everywhere a device name is rendered.
 *
 * `renameDevice` used to revalidate `/` and the device page only, so a renamed
 * box kept its old name on the manual deploy picker, the monitoring feed and
 * any open rollout until something else happened to invalidate them. The
 * dynamic form is the only option for a batch, where there is no single id.
 */
function revalidateDeviceNames(): void {
  revalidatePath("/");
  revalidatePath("/manual");
  revalidatePath("/monitoring");
  revalidatePath("/devices/[id]", "page");
  revalidatePath("/rollouts/[id]", "page");
}

export async function renameDevice(deviceId: string, name: string): Promise<ActionState> {
  const user = await requireOperator();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name cannot be empty." };

  const before = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { name: true, serial: true },
  });
  if (!before) return { error: "That device is already gone." };

  await prisma.device.update({ where: { id: deviceId }, data: { name: trimmed } });

  // Logged like every other device action. Its absence was an outlier next to
  // `setDeviceApproval` and `deleteDevice`, and this row is the only place the
  // old name survives.
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.rename",
      targetType: "Device",
      targetId: deviceId,
      meta: { serial: before.serial, from: before.name, to: trimmed },
    },
  });

  revalidateDeviceNames();
  return { ok: true };
}

export async function setDeviceGroup(deviceId: string, groupId: string): Promise<ActionState> {
  await requireOperator();
  await prisma.device.update({
    where: { id: deviceId },
    data: { groupId: groupId || null },
  });
  revalidatePath("/");
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true };
}

export async function rebootDevice(deviceId: string): Promise<ActionState> {
  const user = await requireOperator();
  try {
    await hub.rebootDevice(deviceId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.reboot",
      targetType: "Device",
      targetId: deviceId,
    },
  });
  return { ok: true, message: "Reboot sent." };
}

/**
 * Run a command on the box and return what it printed.
 *
 * This is a root shell on someone's living-room hardware, so it is operators
 * only and every invocation goes in the audit log with the command itself —
 * the same footing as the pre/post-install hooks, which have always been able
 * to run anything.
 */
export async function execOnDevice(
  deviceId: string,
  command: string,
): Promise<ActionState & { output?: string; failed?: boolean }> {
  const user = await requireOperator();
  const trimmed = command.trim();
  if (!trimmed) return { error: "Nothing to run." };

  let result: { ok: boolean; output: string; error: string | null };
  try {
    result = await hub.execOnDevice(deviceId, trimmed);
  } catch (err) {
    return { error: toMessage(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.exec",
      targetType: "Device",
      targetId: deviceId,
      meta: { command: trimmed, ok: result.ok },
    },
  });

  return {
    ok: true,
    failed: !result.ok,
    output: result.output,
    message: result.ok ? "Command ran." : (result.error ?? "The command failed."),
  };
}

/**
 * Collect the box's logs and hand back the bundle to download.
 *
 * The call blocks while the box zips and uploads — usually a few seconds — so
 * the caller gets either a bundle id it can send the browser to, or the reason
 * there is none. Nothing to poll.
 */
export async function collectDeviceLogs(
  deviceId: string,
): Promise<ActionState & { bundleId?: string }> {
  const user = await requireOperator();
  let bundleId: string;
  try {
    ({ bundleId } = await hub.collectDeviceLogs(deviceId, user.id));
  } catch (err) {
    return { error: toMessage(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.logs",
      targetType: "Device",
      targetId: deviceId,
      meta: { bundleId },
    },
  });

  return { ok: true, bundleId };
}

/**
 * Rotom-side control. `restart` is the useful one day to day: it kicks the
 * scanner app without rebooting the whole box.
 */
export async function rotomDeviceAction(
  deviceId: string,
  action: "restart" | "reboot" | "enable" | "disable",
): Promise<ActionState> {
  const user = await requireOperator();
  try {
    await hub.rotomDeviceAction(deviceId, action);
  } catch (err) {
    return { error: toMessage(err) };
  }
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: `rotom.${action}`,
      targetType: "Device",
      targetId: deviceId,
    },
  });
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true, message: `Rotom: ${action} sent.` };
}

export async function syncRotom(): Promise<ActionState> {
  await requireOperator();
  try {
    const { seen, matched } = await hub.rotomSync();
    revalidatePath("/");
    return { ok: true, message: `Rotom knows ${seen} device(s); ${matched} matched.` };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

/**
 * Removing a device drops its token, so the box goes quiet until it is
 * re-enrolled. Its job history goes with it.
 */
export async function deleteDevice(deviceId: string): Promise<ActionState> {
  const user = await requireOperator();
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return { error: "Device not found." };

  await prisma.device.delete({ where: { id: deviceId } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.delete",
      targetType: "Device",
      targetId: deviceId,
      meta: { serial: device.serial, name: device.name },
    },
  });
  revalidatePath("/");
  return { ok: true };
}

// --- naming many boxes at once ---------------------------------------------

/**
 * Whether a group writes the device name into the config it puts on its boxes.
 *
 * Matched the way the hub's renderer does rather than with `includes`, because
 * it trims what is inside the braces and `{{ device.name }}` is legal there.
 */
const NAME_PLACEHOLDER = /\{\{\s*device\.name\s*\}\}/;

const RENAME_SELECT = {
  id: true,
  name: true,
  serial: true,
  model: true,
  manufacturer: true,
  createdAt: true,
  group: { select: { name: true, mitmConfigPath: true, mitmConfig: true } },
} as const;

type LoadedDevice = {
  id: string;
  name: string;
  serial: string;
  model: string | null;
  manufacturer: string | null;
  createdAt: Date;
  group: { name: string; mitmConfigPath: string | null; mitmConfig: string | null } | null;
};

/**
 * The group's config never leaves the server — only the one fact the preview
 * needs from it. It holds `authBearer` and `deviceAuthToken`, which is why the
 * settings page already blanks it for a VIEWER.
 */
function toTarget(device: LoadedDevice): RenameTarget {
  return {
    id: device.id,
    name: device.name,
    serial: device.serial,
    model: device.model,
    manufacturer: device.manufacturer,
    groupName: device.group?.name ?? null,
    createdAt: device.createdAt.toISOString(),
    configGoesStale: Boolean(
      device.group?.mitmConfig && NAME_PLACEHOLDER.test(device.group.mitmConfig),
    ),
  };
}

/**
 * Everything the rename dialog needs, in one round trip when it opens.
 *
 * The whole fleet's names come too, because a name that collides with a box
 * outside the selection is worth showing and the dialog cannot know about one.
 * Fetched on open rather than passed as props: the settings page has no device
 * list, and giving it one would ship every name on every settings visit.
 */
export async function loadRenameTargets(
  source: { deviceIds: string[] } | { groupId: string },
): Promise<ActionState & { targets?: RenameTarget[]; fleet?: { id: string; name: string }[] }> {
  await requireOperator();

  const where =
    "groupId" in source
      ? { groupId: source.groupId, approved: true }
      : { id: { in: source.deviceIds } };

  const [devices, fleet] = await Promise.all([
    prisma.device.findMany({ where, select: RENAME_SELECT }),
    prisma.device.findMany({ select: { id: true, name: true } }),
  ]);
  if (devices.length === 0) return { error: "No boxes to rename." };

  // Put them back in the order the caller asked for, which for the fleet table
  // is the order on screen — the one the counter follows.
  const byId = new Map(devices.map((device) => [device.id, device]));
  const inOrder =
    "deviceIds" in source
      ? source.deviceIds.map((id) => byId.get(id)).filter((d): d is LoadedDevice => Boolean(d))
      : devices;

  return { ok: true, targets: inOrder.map(toTarget), fleet };
}

/**
 * Read the name each box's own MITM config already uses.
 *
 * For somebody pointing Magnemite at a fleet that is already running: the names
 * exist, on the boxes, and retyping them is work with a typo in it. The key to
 * read is not guessed — it is wherever that group's template puts
 * `{{device.name}}`, so the two always agree.
 *
 * The file holds `authBearer` and `deviceAuthToken`. Only the one string comes
 * back; the config body never reaches the browser, the log or the audit row.
 */
export async function readNamesFromBoxes(
  deviceIds: string[],
): Promise<ActionState & { found?: Record<string, { name: string | null; reason?: string }> }> {
  const user = await requireOperator();
  if (deviceIds.length === 0) return { error: "No boxes picked." };

  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds } },
    select: { id: true, name: true, group: { select: { mitmConfigPath: true, mitmConfig: true } } },
  });

  const found: Record<string, { name: string | null; reason?: string }> = {};
  const BATCH = 5;
  // Under the five minutes the dashboard's fetch allows. A box that never
  // answers costs the hub's exec timeout, so a large silent set would run past
  // it and lose every row — including the ones that did answer.
  const DEADLINE_MS = 3 * 60_000;
  const startedAt = Date.now();

  for (let i = 0; i < devices.length; i += BATCH) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      for (const device of devices.slice(i)) {
        found[device.id] = { name: null, reason: "not read — the batch ran out of time" };
      }
      break;
    }
    await Promise.all(
      devices.slice(i, i + BATCH).map(async (device) => {
        const path = device.group?.mitmConfigPath;
        const template = device.group?.mitmConfig;
        if (!path || !template) {
          found[device.id] = { name: null, reason: `${device.name} is in no group with a config` };
          return;
        }
        const key = nameKeyIn(template);
        if (!key) {
          found[device.id] = {
            name: null,
            reason: "this group's config has no field that is exactly {{device.name}}",
          };
          return;
        }
        try {
          const result = await hub.execOnDevice(device.id, `cat ${JSON.stringify(path)}`);
          if (!result.ok) {
            found[device.id] = { name: null, reason: result.error ?? `could not read ${path}` };
            return;
          }
          const value = readAt(JSON.parse(result.output) as unknown, key);
          found[device.id] =
            typeof value === "string" && value.trim()
              ? { name: value.trim() }
              : {
                  name: null,
                  reason: `${key.join(".")} is not set in the config on ${device.name}`,
                };
        } catch (err) {
          found[device.id] = {
            name: null,
            // Never the output: a parse failure means we are holding the file.
            reason:
              err instanceof SyntaxError
                ? `the config on ${device.name} is not JSON`
                : toMessage(err),
          };
        }
      }),
    );
  }

  const read = Object.values(found).filter((entry) => entry.name).length;
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.namesImported",
      targetType: "Device",
      meta: { devices: devices.length, found: read, skipped: devices.length - read },
    },
  });

  return { ok: true, found, message: `Read ${read} of ${devices.length}.` };
}

/** Where the template puts the name, as a key path, or null if nowhere. */
function nameKeyIn(template: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(template.replace(/\{\{[^{}]*\}\}/g, (token) => JSON.stringify(token)));
  } catch {
    return null;
  }
  let hit: string[] | null = null;
  const walk = (value: unknown, path: string[]) => {
    if (hit) return;
    // Only an exact match. A template like "tv-{{device.name}}" would need the
    // prefix stripped back off whatever the box reports, and guessing that
    // wrong writes a wrong name to the fleet.
    if (
      typeof value === "string" &&
      NAME_PLACEHOLDER.test(value) &&
      value.trim().match(/^\{\{[^{}]*\}\}$/)
    ) {
      hit = path;
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        walk(inner, [...path, key]);
      }
    }
  };
  walk(parsed, []);
  return hit;
}

function readAt(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Apply a rename to many boxes.
 *
 * The plan is worked out again here rather than trusting the names the browser
 * drew: the preview is a convenience, and this is the authority.
 */
export async function renameDevices(
  input:
    | ({ deviceIds: string[] } & RenameOptions)
    | { deviceIds: string[]; names: Record<string, { name: string | null; reason?: string }> },
): Promise<ActionState & { renamed?: number }> {
  const user = await requireOperator();
  if (input.deviceIds.length === 0) return { error: "No boxes picked." };

  const [devices, fleet] = await Promise.all([
    prisma.device.findMany({ where: { id: { in: input.deviceIds } }, select: RENAME_SELECT }),
    prisma.device.findMany({ select: { id: true, name: true } }),
  ]);
  if (devices.length !== input.deviceIds.length) {
    return { error: "A box in the selection is no longer there. Reopen the dialog." };
  }

  const byId = new Map(devices.map((device) => [device.id, device]));
  const targets = input.deviceIds
    .map((id) => byId.get(id))
    .filter((d): d is LoadedDevice => Boolean(d))
    .map(toTarget);

  const plan =
    "names" in input
      ? planFromNames(targets, fleet, input.names)
      : planRename(targets, fleet, input);
  if (plan.error) return { error: plan.error };

  const changes = plan.rows.filter((row) => row.status === "rename");
  if (changes.length === 0) return { error: "Nothing to change." };

  // One transaction: a naming scheme half-applied leaves the fleet in two
  // schemes and the operator working out which boxes are missing.
  await prisma.$transaction(
    changes.map((row) =>
      prisma.device.update({ where: { id: row.deviceId }, data: { name: row.to } }),
    ),
  );

  const serials = new Map(devices.map((device) => [device.id, device.serial]));
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.rename",
      targetType: "Device",
      // The old names, not just a count: this row is the only place they
      // survive, and "somebody renamed forty boxes with a bad pattern" has to
      // be answerable.
      meta: {
        ...("names" in input
          ? { source: "boxes" }
          : {
              pattern: input.pattern,
              order: input.order,
              startAt: input.startAt,
              step: input.step,
            }),
        devices: targets.length,
        renamed: changes.map((row) => ({
          serial: serials.get(row.deviceId) ?? null,
          from: row.from,
          to: row.to,
        })),
      },
    },
  });

  revalidateDeviceNames();
  return {
    ok: true,
    renamed: changes.length,
    message: `Renamed ${changes.length} box${changes.length === 1 ? "" : "es"}.`,
  };
}
