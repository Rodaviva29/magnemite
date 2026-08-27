import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Unlike the dashboard, this app has no Prisma query engine that has to sit
  // next to its client, so the traced standalone output is safe -- and it is
  // the difference between a ~200 MB image and the ~800 MB a copy of the whole
  // workspace node_modules costs.
  output: "standalone",
  // The traced files live in the workspace root's node_modules, one pnpm
  // symlink away, so tracing has to start there rather than at this app.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default withMDX(config);
