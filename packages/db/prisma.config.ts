import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "../../.env");

// A config file turns off Prisma's own `.env` loading, so load the repo's
// root .env here for local runs. Values already in the environment win, which
// is what the containers rely on — they ship no .env file at all.
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Prisma's config file, replacing the deprecated `package.json#prisma` block
 * that Prisma 7 drops.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
