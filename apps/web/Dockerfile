# Build context is the repo root: the dashboard imports two workspace packages.
FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @magnemite/db generate
RUN pnpm --filter @magnemite/web build
# The build cache is only useful to a rebuild, and it is hundreds of MB.
RUN rm -rf /app/apps/web/.next/cache

FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
