# Build context is the repo root: the hub bundles two workspace packages.
FROM node:22-alpine AS build
# pnpm is baked into the image below with `corepack install`: with only
# `corepack enable`, the first pnpm call in a fresh container downloads the
# tarball from the npm registry, which prints a prompt warning and puts the
# registry on the path of every container start.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# `packageManager` in package.json pins the version.
RUN corepack install
COPY packages ./packages
COPY apps/hub ./apps/hub

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @magnemite/db generate
RUN pnpm --filter @magnemite/hub build

FROM node:22-alpine AS runtime
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

# Dev dependencies come along on purpose: the entrypoint runs
# `prisma migrate deploy`, which needs the Prisma CLI at runtime.
COPY --from=build /app ./
# `packageManager` in the copied package.json pins the version.
RUN corepack install
COPY apps/hub/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/hub/dist/index.js"]
