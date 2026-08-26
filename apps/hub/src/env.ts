import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  HUB_PORT: z.coerce.number().int().positive().default(3001),
  HUB_HOST: z.string().default("0.0.0.0"),
  /** Shared secret the dashboard uses on /internal/* calls. */
  HUB_INTERNAL_SECRET: z.string().min(8),
  /** Base URL agents see. Artifact URLs are built from this. */
  MAGNEMITE_PUBLIC_URL: z.string().url(),
  ARTIFACT_DIR: z.string().default("/data/artifacts"),

  /** Fleet-wide cap on how many devices download + install at once. */
  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(10),
  /** Seconds of silence from an agent mid-job before the job is re-queued. */
  JOB_STALL_TIMEOUT: z.coerce.number().int().positive().default(900),
  /** Seconds without a heartbeat before a device is marked offline. */
  DEVICE_OFFLINE_TIMEOUT: z.coerce.number().int().positive().default(70),

  GITHUB_TOKEN: z.string().optional(),
  SOURCE_POLL_MINUTES: z.coerce.number().int().positive().default(15),

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
