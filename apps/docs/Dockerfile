# Build context is the repo root: the lockfile and the workspace manifest live
# there, even though this app imports no workspace package.
FROM node:22-alpine AS build
# pnpm is baked into the image below with `corepack install`: with only
# `corepack enable`, the first pnpm call in a fresh container downloads the
# tarball from the npm registry, which prints a prompt warning and puts the
# registry on the path of every container start.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# `packageManager` in package.json pins the version.
RUN corepack install
COPY apps/docs ./apps/docs

# `pnpm install` runs this app's postinstall (`fumadocs-mdx`), which needs
# next.config.mjs in place -- hence the COPY above it.
RUN pnpm install --frozen-lockfile --filter @magnemite/docs...
RUN pnpm --filter @magnemite/docs build

# The dashboard's image keeps the whole workspace because Prisma's query engine
# has to sit next to its client. Nothing here does, so the runtime is Next's
# traced standalone output: node_modules shrinks to what the pages actually
# import, and no package manager is needed to start it.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/docs/.next/standalone ./
COPY --from=build /app/apps/docs/.next/static ./apps/docs/.next/static

EXPOSE 3002
CMD ["node", "apps/docs/server.js"]
