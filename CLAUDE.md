# Working on Magnemite

A fleet manager for rooted Android TV boxes: a Go agent on each box, a Node hub
holding their sockets, a Next dashboard, Postgres or MariaDB behind both.

**The real documentation is in `apps/docs/content/docs/`** and it is good — read
it rather than re-deriving. `development/local.mdx` is the setup, and
`development/fake-fleet.mdx` covers testing without hardware.

This file is only the things that cost time and are written nowhere else.

---

## Never run two dev servers for `apps/web`

Both compile into the same `apps/web/.next`, and each one deletes the other's
output. The symptom is baffling: a route logs `✓ Compiled /settings` and then
`GET /settings 404`, with `ENOENT` on files under `.next/server/app/`.

Before starting one, check nothing else is already serving the web app:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next@15' } |
  ForEach-Object { "$($_.ProcessId)  $((Get-NetTCPConnection -OwningProcess $_.ProcessId -State Listen -EA SilentlyContinue).LocalPort)" }
```

If `.next` is already corrupted, stop every web server, `rm -rf apps/web/.next`,
then start exactly one.

## Local setup

```sh
docker compose --env-file .env -f deploy/compose.yml up -d postgres
pnpm --filter @magnemite/db exec prisma migrate deploy
pnpm db:seed          # admin, app target + its sources, group, first token
pnpm dev              # web :3000 · hub :3001 · docs :3002
```

`pnpm db:seed` prints the enrollment token **once** — keep it, the fake fleet
needs it. Login comes from `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

The hub runs under `tsx watch`, so **every file save restarts it and drops all
device sockets**. Boxes reconnect over a few seconds. That alone explains most
"devices went offline" and "gaps in the metric charts" moments while developing.

## Fake fleet (Windows)

```powershell
./scripts/build-agent.ps1 -SkipModule
./scripts/fake-fleet.ps1 -Count 8 -Token <enrollment-token>
Get-Content .dev\fleet\pids.txt | ForEach-Object { Stop-Process -Id $_ -Force }
```

Three traps, all of which look like something else:

- **Stop the fleet before rebuilding.** Windows locks a running `.exe`, and the
  build fails with `permission denied` on `magnemite-agent-windows-amd64.exe`.
- **Agent logs go to stderr**, so `.dev/fleet/fake-NNN.log` is empty and
  everything is in **`.dev/fleet/fake-NNN.log.err`**.
- **`make` needs Git Bash**, not PowerShell — the Makefile shells out to `awk`
  and `pwd`. In Git Bash, docker volume paths need `MSYS_NO_PATHCONV=1`:

```sh
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/agent":/src -w /src \
  golang:1.23-alpine sh -c 'gofmt -l . && go vet ./... && go test ./...'
```

## Driving the app without a browser

The hub's `/internal/*` API takes `x-magnemite-secret: $HUB_INTERNAL_SECRET` and
is the fastest way to exercise a real flow — poll sources, cache a version,
start a rollout across the fake fleet, all with `curl`.

For the dashboard, log in with `POST /api/auth/sign-in/email` and keep the
cookie jar.

**Grepping rendered HTML misleads.** Most tables and forms are client
components, so their _labels_ live in the JS chunk and never appear in the SSR
output — only their props do, inside the flight payload. `"Add an app target"
not in the HTML` proves nothing. Grep for the prop values instead.

## Where settings live

Two homes, and the split matters:

- **`.env`** — what is needed to boot and connect: database, secrets, ports,
  URLs. Changes per environment.
- **Settings → Hub** — what is tuned while running: concurrency, intervals,
  retention, heartbeat. Same everywhere, wants changing without a deploy.

Several values moved from the first to the second and the old variables are now
**ignored in silence**, which is the trap of that migration. The hub adopts a
leftover `AGENT_UPDATE_CONCURRENCY` or `DEVICE_OFFLINE_TIMEOUT` once at boot and
then ignores it.

The hub caches these in `apps/hub/src/services/hubSettings.ts` and is told to
drop the copy by `POST /internal/settings` when the dashboard saves. Nothing
polls. **A value changed straight in psql therefore needs a hub restart, or one
Save from the dashboard.** Do not add a cache anywhere else — the dashboard read
one once, and a stale copy made saved settings look like they reverted to the
defaults.

Three of them are coupled and the form enforces it:
`deviceOfflineTimeout ≥ 3 × heartbeat`, `metricsSampleSeconds ≥ heartbeat`.
The heartbeat is the only setting that lives on the boxes — a box adopts it in
the `welcome` on its **next connection**, not immediately.

## Version sources

Feeds are rows in the database, not config. Two things surprise people:

- The UnownHash mirror needs its base URL set to
  `https://mirror.unownhash.com/apks/`. Without the suffix the index parses fine
  and every download 404s.
- A build listed by two feeds is stored **once**, attributed to the feed with
  the lowest `priority`. So a feed can be working perfectly and show zero
  versions, because the other one won every build. Check
  `Settings → Version sources` for what each feed actually listed.

## Checks

```sh
pnpm --filter @magnemite/web typecheck
pnpm --filter @magnemite/hub exec tsc --noEmit
npx prettier --write <files>
make agent-test        # Git Bash only
```

Prisma schema is **generated**: edit `packages/db/prisma/schema.base.prisma`,
never `schema.prisma`. Migrations must be written for both providers —
`prisma/migrations/` and `prisma/migrations-mysql/`.
