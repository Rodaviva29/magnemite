/**
 * The pattern language for naming many boxes at once.
 *
 * A plain array and a pure function, with no imports at all — deliberately, and
 * for the same reason `config-placeholders.ts` has none. This is imported by a
 * server action, to work out what to write, and by a client component, to draw
 * the preview. `@magnemite/db` drags Prisma and `@magnemite/protocol` drags
 * every zod schema in the wire protocol; neither belongs in a browser bundle.
 *
 * The renderer lives here too, unlike the config placeholders, where the hub
 * owns it. The preview and the apply path are the two things that must not
 * disagree: the preview is what the operator approved, and the apply path is
 * what actually runs. One function, called from both.
 */

/**
 * Single braces, not the `{{...}}` a MITM config template uses.
 *
 * The same braces would promise the same vocabulary, and these two languages
 * are not the same one: a rename has `{n}`, which no config has, and must not
 * offer `{{device.publicIp}}`, because a name that encodes a DHCP lease becomes
 * a lie the next time the lease moves. Different braces say "different
 * language" before a refusal has to.
 */
const TOKEN = /\{([^{}]*)\}/g;

/** What may appear between the braces. */
export const RENAME_TOKENS = ["n", "serial", "group", "model", "manufacturer", "name"] as const;
export type RenameToken = (typeof RENAME_TOKENS)[number];

/** The two that take a `:N`, and what N means for each. */
const TAKES_WIDTH: Record<string, "pad" | "tail"> = { n: "pad", serial: "tail" };

/**
 * A name is a table cell, a line in a Discord alert, and the `deviceName` a
 * scanner writes into its own logs. Past this it stops being readable in all
 * three.
 */
const MAX_NAME = 64;

export type RenameOrder = "table" | "serial" | "name" | "created";

export type RenameTarget = {
  id: string;
  name: string;
  serial: string;
  model: string | null;
  manufacturer: string | null;
  groupName: string | null;
  /** ISO, so this module stays free of Date parsing rules it cannot see. */
  createdAt: string;
  /**
   * Whether this box's group writes the name into its scanner config. Computed
   * server-side from the group's template: the template itself holds bearer
   * tokens and never reaches the browser.
   */
  configGoesStale: boolean;
};

export type RenameRow = {
  deviceId: string;
  from: string;
  to: string;
  /** `skipped` is a row the pattern cannot name; the rest of the batch is fine. */
  status: "rename" | "unchanged" | "skipped";
  /** Why it was skipped, naming the box and the field. */
  reason?: string;
  /** Shares its new name with another row, or with a box outside the batch. */
  duplicate?: boolean;
};

export type RenamePlan = {
  /** In counter order, so the numbers read down the column. */
  rows: RenameRow[];
  /** The pattern itself is unusable. Nothing can be previewed or applied. */
  error: string | null;
  counts: {
    total: number;
    renamed: number;
    unchanged: number;
    skipped: number;
    duplicate: number;
    /** Of the rows being renamed, how many leave a stale config on the box. */
    stale: number;
  };
};

export type RenameOptions = {
  pattern: string;
  order: RenameOrder;
  startAt: number;
  step: number;
};

/**
 * Numeric-aware compare, so `tv-9` sorts before `tv-10`.
 *
 * `compareValues` in `lib/table-sort.ts` is exactly this, and cannot be
 * imported: that module is `"use client"`, and this one is called from a server
 * action. Three lines duplicated on purpose rather than making the table's sort
 * hook importable on the server.
 */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * What is wrong with the pattern itself, or null.
 *
 * Matched permissively and judged by name afterwards, which is the lesson the
 * hub's config renderer learned the hard way: a regex that only matched
 * `[a-zA-Z0-9_.]` did not match `{device-name}` at all, so a typo was neither
 * substituted nor reported — it was written through verbatim.
 */
function checkPattern(pattern: string): string | null {
  if (!pattern.trim()) return "Write a pattern first.";

  const known: readonly string[] = RENAME_TOKENS;
  for (const match of pattern.matchAll(TOKEN)) {
    const raw = (match[1] ?? "").trim();
    const [name = "", width] = raw.split(":", 2);

    if (!known.includes(name)) {
      return `Unknown token {${raw}}. Known: ${RENAME_TOKENS.map((t) => `{${t}}`).join(", ")}.`;
    }
    if (width === undefined) continue;

    if (!TAKES_WIDTH[name]) {
      return `{${name}} takes no number. Only {n} and {serial} do.`;
    }
    if (!/^\d+$/.test(width) || Number(width) < 1) {
      return `{${raw}} needs a whole number after the colon, like {${name}:2}.`;
    }
  }

  // A brace the regex never saw, because it was never closed. `tv-{n:02`
  // matches nothing, so without this it would be written through literally.
  const stripped = pattern.replace(TOKEN, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    return "There is a { without a matching }.";
  }
  return null;
}

/** One box's name, or why the pattern cannot name it. */
function renderName(
  pattern: string,
  target: RenameTarget,
  counter: number,
): { ok: true; name: string } | { ok: false; reason: string } {
  let missing: string | null = null;

  const text = pattern.replace(TOKEN, (_whole, raw: string) => {
    const [name = "", width] = raw.trim().split(":", 2);
    const pad = width === undefined ? 0 : Number(width);

    switch (name) {
      case "n":
        return String(counter).padStart(pad, "0");
      case "serial":
        // The tail, never the head: the leading characters are a vendor prefix
        // and are identical across a fleet of identical boxes, which is why
        // enrolment also names a box from `serial.slice(-6)`.
        return pad > 0 ? target.serial.slice(-pad) : target.serial;
      case "group":
        return need(target.groupName, "{group}");
      case "model":
        return need(target.model, "{model}");
      case "manufacturer":
        return need(target.manufacturer, "{manufacturer}");
      case "name":
        return target.name;
      default:
        return "";
    }
  });

  function need(value: string | null, token: string): string {
    if (value === null || value === "") {
      missing ??= token;
      return "";
    }
    return value;
  }

  if (missing) return { ok: false, reason: `${missing} is empty on ${target.name}` };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: `the pattern renders empty on ${target.name}` };
  // \p{Cc} rather than a literal range: a name pasted out of a spreadsheet can
  // carry a newline, and a newline in a Discord alert line is not a name.
  if (/\p{Cc}/u.test(trimmed)) {
    return { ok: false, reason: `the name for ${target.name} has a control character in it` };
  }
  if (trimmed.length > MAX_NAME) {
    return {
      ok: false,
      reason: `the name for ${target.name} is longer than ${MAX_NAME} characters`,
    };
  }
  return { ok: true, name: trimmed };
}

function ordered(targets: RenameTarget[], order: RenameOrder): RenameTarget[] {
  // "table" means the caller already put them in the order the operator can
  // see, so touching it would be second-guessing the screen.
  if (order === "table") return targets;
  const sorted = [...targets];
  switch (order) {
    case "serial":
      return sorted.sort((a, b) => compareText(a.serial, b.serial));
    case "name":
      return sorted.sort((a, b) => compareText(a.name, b.name));
    case "created":
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

/**
 * Mark the duplicates and count everything up.
 *
 * Shared by both modes so a pattern and an import cannot end up disagreeing
 * about what a duplicate is: the rules are the same either way, and the only
 * difference between the modes is where `to` came from.
 */
function finish(
  rows: RenameRow[],
  targets: RenameTarget[],
  fleet: { id: string; name: string }[],
): RenamePlan {
  // Case-insensitively, because `TV-01` and `tv-01` are not told apart by
  // anyone reading a table or an alert.
  const targetIds = new Set(targets.map((t) => t.id));
  const taken = new Map<string, number>();
  const bump = (name: string) => {
    const key = name.toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  };

  for (const box of fleet) if (!targetIds.has(box.id)) bump(box.name);
  for (const row of rows) if (row.status !== "skipped") bump(row.to);
  for (const row of rows) {
    if (row.status !== "skipped" && (taken.get(row.to.toLowerCase()) ?? 0) > 1)
      row.duplicate = true;
  }

  const stale = new Set(targets.filter((t) => t.configGoesStale).map((t) => t.id));
  return {
    rows,
    error: null,
    counts: {
      total: rows.length,
      renamed: rows.filter((r) => r.status === "rename").length,
      unchanged: rows.filter((r) => r.status === "unchanged").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      duplicate: rows.filter((r) => r.duplicate).length,
      stale: rows.filter((r) => r.status === "rename" && stale.has(r.deviceId)).length,
    },
  };
}

/**
 * What renaming this set with this pattern would do.
 *
 * `fleet` is every box, the targets included — this subtracts them itself, so
 * no caller can get the exclusion wrong and report a box as colliding with its
 * own old name.
 *
 * Duplicates are marked, never refused. Two boxes at two sites really can both
 * be `spare`, and the preview is what makes the accidental case — a pattern
 * with no `{n}` — obvious before anyone clicks.
 */
export function planRename(
  targets: RenameTarget[],
  fleet: { id: string; name: string }[],
  options: RenameOptions,
): RenamePlan {
  const empty = {
    total: targets.length,
    renamed: 0,
    unchanged: 0,
    skipped: 0,
    duplicate: 0,
    stale: 0,
  };

  const bad = checkPattern(options.pattern);
  if (bad) return { rows: [], error: bad, counts: empty };

  const step = Number.isFinite(options.step) && options.step !== 0 ? Math.trunc(options.step) : 1;
  const start = Number.isFinite(options.startAt) ? Math.trunc(options.startAt) : 1;

  const rows: RenameRow[] = [];
  ordered(targets, options.order).forEach((target, index) => {
    // Unchanged rows still consume a counter value. Skipping them would
    // renumber everything below on the coincidence of one box already having
    // the name the pattern was about to give it.
    const rendered = renderName(options.pattern, target, start + index * step);
    if (!rendered.ok) {
      rows.push({
        deviceId: target.id,
        from: target.name,
        to: "",
        status: "skipped",
        reason: rendered.reason,
      });
      return;
    }
    rows.push({
      deviceId: target.id,
      from: target.name,
      to: rendered.name,
      status: rendered.name === target.name ? "unchanged" : "rename",
    });
  });

  return finish(rows, targets, fleet);
}

/**
 * The same shape, for names read off the boxes rather than rendered.
 *
 * Shares the duplicate marking and the length and emptiness rules, so the two
 * modes cannot disagree about what a usable name is.
 */
export function planFromNames(
  targets: RenameTarget[],
  fleet: { id: string; name: string }[],
  names: Record<string, { name: string | null; reason?: string }>,
): RenamePlan {
  const rows: RenameRow[] = targets.map((target) => {
    const found = names[target.id];
    const value = found?.name?.trim() ?? "";
    if (!value) {
      return {
        deviceId: target.id,
        from: target.name,
        to: "",
        status: "skipped" as const,
        reason: found?.reason ?? `no name came back from ${target.name}`,
      };
    }
    if (value.length > MAX_NAME) {
      return {
        deviceId: target.id,
        from: target.name,
        to: "",
        status: "skipped" as const,
        reason: `the name on ${target.name} is longer than ${MAX_NAME} characters`,
      };
    }
    return {
      deviceId: target.id,
      from: target.name,
      to: value,
      status: value === target.name ? ("unchanged" as const) : ("rename" as const),
    };
  });

  return finish(rows, targets, fleet);
}
