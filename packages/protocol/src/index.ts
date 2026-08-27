import { z } from "zod";

/**
 * Wire protocol between the Go agent on each Android TV and the hub.
 *
 * Every frame is JSON with a `type` discriminator. The Go side mirrors these
 * shapes in agent/internal/protocol/protocol.go — change both together.
 *
 * Compatibility rule: agents update themselves over the air and a box that is
 * powered off for a month will reconnect running an old build. Only ever add
 * optional fields; never repurpose or remove one.
 */
export const PROTOCOL_VERSION = 1;

/** Mirrors the JobState enum in the Prisma schema. */
export const jobStateSchema = z.enum([
  "QUEUED",
  "DISPATCHED",
  "DOWNLOADING",
  "EXTRACTING",
  "INSTALLING",
  "VERIFYING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
]);
export type JobStateWire = z.infer<typeof jobStateSchema>;

export const installModeSchema = z.enum(["IN_PLACE", "CLEAN"]);
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);

export const packageInfoSchema = z.object({
  packageName: z.string(),
  versionName: z.string().nullish(),
  /** Android versionCode. Sent as a string: it can exceed 2^31. */
  versionCode: z.string().nullish(),
  installed: z.boolean().default(true),
});
export type PackageInfo = z.infer<typeof packageInfoSchema>;

export const deviceInfoSchema = z.object({
  serial: z.string().min(1),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
  androidVersion: z.string().nullish(),
  sdkInt: z.number().int().nullish(),
  abi: z.string().nullish(),
  /** ro.sf.lcd_density, used to pick the right density split out of the .apkm. */
  density: z.number().int().nullish(),
  /**
   * The box's own LAN address (192.168.x.x and friends). The socket's remote
   * address is the reverse proxy on the hub's overlay network, so it is the
   * same useless 10.x for every device; only the agent knows where the box
   * actually lives on the local network. Null on agents old enough not to
   * report it.
   */
  localIp: z.string().nullish(),
});

export const deviceMetricsSchema = z.object({
  /** Free bytes on /data — the partition the install session writes to. */
  freeBytes: z.number().nonnegative().nullish(),
  totalBytes: z.number().nonnegative().nullish(),
  uptimeSeconds: z.number().int().nonnegative().nullish(),
  packages: z.array(packageInfoSchema).default([]),
  /**
   * Set when `packages` is the whole third-party inventory rather than just
   * the tracked apps. Only a complete list is evidence that an app was
   * uninstalled, so the hub will not mark anything gone without it.
   */
  packagesComplete: z.boolean().default(false),

  /**
   * Health signals read out of /proc on every heartbeat. All optional: a box
   * running an agent from before these existed simply never sends them, and
   * the dashboard shows the fields as unknown rather than as zero.
   */
  loadAvg1: z.number().nonnegative().nullish(),
  loadAvg5: z.number().nonnegative().nullish(),
  loadAvg15: z.number().nonnegative().nullish(),
  cpuCount: z.number().int().positive().nullish(),
  memTotalBytes: z.number().nonnegative().nullish(),
  memAvailableBytes: z.number().nonnegative().nullish(),
});

// ---------------------------------------------------------------------------
// agent -> hub
// ---------------------------------------------------------------------------

export const helloSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int().default(1),
  agentVersion: z.string(),
  device: deviceInfoSchema,
  metrics: deviceMetricsSchema,
  /** Set when the agent is resuming a job it was running before it restarted. */
  currentJobId: z.string().nullish(),
});

export const heartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  metrics: deviceMetricsSchema,
  currentJobId: z.string().nullish(),
});

export const jobProgressSchema = z.object({
  type: z.literal("job_progress"),
  jobId: z.string(),
  state: jobStateSchema,
  /** 0-100 within the current state. */
  progress: z.number().int().min(0).max(100).default(0),
  message: z.string().nullish(),
});

export const jobResultSchema = z.object({
  type: z.literal("job_result"),
  jobId: z.string(),
  ok: z.boolean(),
  installMode: installModeSchema.nullish(),
  /** True when the install had to uninstall first, wiping app data. */
  dataWiped: z.boolean().default(false),
  installedVersion: z.string().nullish(),
  installedVersionCode: z.string().nullish(),
  error: z.string().nullish(),
});

export const logSchema = z.object({
  type: z.literal("log"),
  jobId: z.string().nullish(),
  level: logLevelSchema.default("INFO"),
  message: z.string(),
});

/**
 * Sent when a self-update does not happen, so a failure is visible in the
 * dashboard rather than only in the box's own log. Success needs no frame:
 * the agent re-execs and the next `hello` carries the new version, which is
 * the only proof that the new binary actually runs.
 */
export const agentUpdateResultSchema = z.object({
  type: z.literal("agent_update_result"),
  /** Version the agent was told to move to. */
  version: z.string(),
  ok: z.boolean(),
  error: z.string().nullish(),
});

/**
 * Closes out a log bundle the agent could not deliver. The bundle itself goes
 * up over HTTP, not through here — a socket frame is capped at 1 MB and a
 * logcat dump is not.
 */
export const logBundleResultSchema = z.object({
  type: z.literal("log_bundle_result"),
  bundleId: z.string(),
  ok: z.boolean(),
  error: z.string().nullish(),
});

/**
 * A batch of live logcat lines, while someone has the panel open.
 *
 * Batched rather than sent per line: a busy box writes thousands a second and
 * one frame each would be the socket's whole budget. `dropped` counts what the
 * agent threw away to keep up, so the panel can say so instead of quietly
 * lying about what the box printed.
 */
export const logLinesSchema = z.object({
  type: z.literal("log_lines"),
  streamId: z.string(),
  lines: z.array(z.string()).default([]),
  dropped: z.number().int().nonnegative().default(0),
});

/** What a one-off command printed, and whether it worked. */
export const execResultSchema = z.object({
  type: z.literal("exec_result"),
  commandId: z.string(),
  ok: z.boolean(),
  /** Combined stdout and stderr, truncated by the agent. */
  output: z.string().default(""),
  /** Set when the shell itself reported a failure. */
  error: z.string().nullish(),
});

export const pongSchema = z.object({ type: z.literal("pong") });

export const agentMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  heartbeatSchema,
  jobProgressSchema,
  jobResultSchema,
  logSchema,
  agentUpdateResultSchema,
  logBundleResultSchema,
  logLinesSchema,
  execResultSchema,
  pongSchema,
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

// ---------------------------------------------------------------------------
// hub -> agent
// ---------------------------------------------------------------------------

export const welcomeSchema = z.object({
  type: z.literal("welcome"),
  deviceId: z.string(),
  name: z.string(),
  approved: z.boolean(),
  heartbeatSeconds: z.number().int().positive().default(20),
  /** Packages the agent should report versions for on every heartbeat. */
  trackedPackages: z.array(z.string()).default([]),
});

export const installJobSchema = z.object({
  type: z.literal("install_job"),
  jobId: z.string(),
  packageName: z.string(),
  /** Absolute URL of the cached .apkm, served by Caddy under /files/. */
  url: z.string().url(),
  sha256: z.string().length(64),
  sizeBytes: z.number().positive(),
  version: z.string(),
  /** Uninstall before installing instead of only on an in-place rejection. */
  forceClean: z.boolean().default(false),
  preInstallHook: z.string().nullish(),
  postInstallHook: z.string().nullish(),
  /**
   * Extra split APKs to install beyond base + the device's own abi/density
   * splits, matched by name. Rarely needed.
   */
  extraSplits: z.array(z.string()).default([]),
  /** Seconds before the agent gives up on the whole job. */
  timeoutSeconds: z.number().int().positive().default(3600),
});
export type InstallJob = z.infer<typeof installJobSchema>;

export const cancelJobSchema = z.object({
  type: z.literal("cancel_job"),
  jobId: z.string(),
});

export const rebootSchema = z.object({ type: z.literal("reboot") });

export const agentUpdateSchema = z.object({
  type: z.literal("agent_update"),
  url: z.string().url(),
  sha256: z.string().length(64),
  version: z.string(),
});

/**
 * Collect the box's logs and PUT them at `uploadUrl`, which carries the
 * bundle's own id and is authenticated with the device token.
 */
export const collectLogsSchema = z.object({
  type: z.literal("collect_logs"),
  bundleId: z.string(),
  uploadUrl: z.string().url(),
  /** Tail of logcat to include. A full buffer is tens of MB. */
  maxLines: z.number().int().positive().default(50_000),
});

export const logStreamStartSchema = z.object({
  type: z.literal("log_stream_start"),
  streamId: z.string(),
  /**
   * Absolute path of a log file to follow. Null means logcat, which is what
   * an agent from before this field understood — and still does, because it
   * simply ignores what it does not know.
   */
  path: z.string().nullish(),
  /**
   * The agent stops on its own after this, so a dashboard tab left open (or a
   * browser that died without closing the stream) never leaves `logcat`
   * running on the box forever.
   */
  durationSeconds: z.number().int().positive().default(300),
});

export const logStreamStopSchema = z.object({
  type: z.literal("log_stream_stop"),
  streamId: z.string(),
});

/**
 * Run a shell command on the box, as root, and say what it printed.
 *
 * The same power the pre/post-install hooks already have — `sh -c`, root,
 * whatever the operator typed — just invoked by hand instead of around an
 * install. It is meant for the scanner-wrangling one-liners (`am force-stop`,
 * `am startservice`) that otherwise need adb and a trip to the box.
 */
export const execCommandSchema = z.object({
  type: z.literal("exec_command"),
  commandId: z.string(),
  command: z.string().min(1),
  timeoutSeconds: z.number().int().positive().default(60),
});

export const pingSchema = z.object({ type: z.literal("ping") });

export const serverMessageSchema = z.discriminatedUnion("type", [
  welcomeSchema,
  installJobSchema,
  cancelJobSchema,
  rebootSchema,
  agentUpdateSchema,
  collectLogsSchema,
  logStreamStartSchema,
  logStreamStopSchema,
  execCommandSchema,
  pingSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------------------------------------------------------------------------
// Enrollment (plain HTTP, before the socket exists)
// ---------------------------------------------------------------------------

export const enrollRequestSchema = z.object({
  enrollmentToken: z.string().min(1),
  /** Optional friendly name; falls back to manufacturer + model + serial tail. */
  name: z.string().nullish(),
  agentVersion: z.string(),
  device: deviceInfoSchema,
});

export const enrollResponseSchema = z.object({
  deviceId: z.string(),
  deviceToken: z.string(),
  name: z.string(),
  approved: z.boolean(),
  wsUrl: z.string(),
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;
