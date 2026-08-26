#!/bin/sh
set -e

# The hub owns schema migrations; web only ever reads the generated client.
echo "[entrypoint] applying database migrations"
# `run` is required: `pnpm deploy` is a built-in command, not our script.
pnpm --filter @magnemite/db run deploy

echo "[entrypoint] starting hub"
exec "$@"
