import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they have to be bundled in
  // rather than resolved at runtime.
  noExternal: ["@magnemite/db", "@magnemite/protocol"],
  // Prisma loads its query engine from disk at runtime; bundling it breaks that.
  external: ["@prisma/client", ".prisma/client"],
});
