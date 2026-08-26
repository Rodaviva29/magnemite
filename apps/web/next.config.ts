import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build output.
  transpilePackages: ["@magnemite/db"],
  // Not `standalone`: the image keeps the full workspace node_modules so
  // Prisma's query engine binary is always where the client looks for it.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: {
    // Server Actions receive device id lists for fleet-wide rollouts.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
