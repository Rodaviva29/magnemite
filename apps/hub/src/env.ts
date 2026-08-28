import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /** Which Prisma connector the database speaks. "mysql" also covers MariaDB. */
  DB_PROVIDER: z.enum(["postgresql", "mysql"]).default("postgresql"),
  HUB_PORT: z.coerce.number().int().positive().default(3001),
  HUB_HOST: z.string().default("0.0.0.0"),
  /** Shared secret the dashboard uses on /internal/* calls. */
  HUB_INTERNAL_SECRET: z.string().min(8),
  /** Base URL agents see. Artifact URLs are built from this. */
  MAGNEMITE_PUBLIC_URL: z.string().url(),
  ARTIFACT_DIR: z.string().default("/data/artifacts"),
  /**
   * Serve /files/* from the hub itself. Off in production, where Caddy does
   * it off the shared volume without Node in the data path.
   */
  SERVE_ARTIFACTS: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /**
   * Agent self-update. The hub image ships the binaries it wants the fleet to
   * run, so a box that reconnects on an older build is told to update itself.
   * Turn it off to pin the fleet and drive updates by hand instead.
   */
  AGENT_AUTO_UPDATE: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /** Where those binaries live, next to the VERSION they were built from. */
  AGENT_BIN_DIR: z.string().default("/app/agent-bin"),
  // How many boxes may swap their binary at once, and how long a box may go
  // quiet before it counts as offline, both live in Settings → Hub, not here.

  ROTOM_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  ROTOM_URL: z.string().optional(),
  ROTOM_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid hub environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
