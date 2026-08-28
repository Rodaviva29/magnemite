# Build context is the repo root: the dashboard imports two workspace packages.
FROM node:22-alpine AS build
# pnpm is baked into the image below with `corepack install`: with only
# `corepack enable`, the first pnpm call in a fresh container downloads the
# tarball from the npm registry, which prints a prompt warning and puts the
# registry on the path of every container start.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

# Which Prisma connector to generate the client for: "postgresql" (default) or
# "mysql", which also covers MariaDB. The Prisma Client baked in here has to
# match the DATABASE_URL the container gets at runtime, so
# deploy/compose.mariadb.yml passes this as a build arg.
ARG DB_PROVIDER=postgresql
ENV DB_PROVIDER=${DB_PROVIDER}

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# `packageManager` in package.json pins the version.
RUN corepack install
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @magnemite/db generate
RUN pnpm --filter @magnemite/web build
# The build cache is only useful to a rebuild, and it is hundreds of MB.
RUN rm -rf /app/apps/web/.next/cache

FROM node:22-alpine AS runtime
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./
# `packageManager` in the copied package.json pins the version.
RUN corepack install
# The release this image was built from, so the Status page can say which one
# is running rather than leaving you to guess from the deploy history.
COPY VERSION /app/VERSION

# `next start` reads PORT, and Coolify reads this pair when it generates the
# service's domain -- the docs image carries the same two lines and is the one
# service whose generated domain came out carrying its port.
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
