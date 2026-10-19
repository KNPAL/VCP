# Study Trade VCP

Indian-equities research and manual-trade tracking application implementing `ST_VCP_4_0`, using Next.js, NestJS, PostgreSQL, Redis and BullMQ. **It does not place broker orders.**

Development is ongoing. You can run the app, sign in and use implemented portfolio/data services, but some screens and trading workflows remain incomplete. Empty data and `UNKNOWN` states are expected until verified data is supplied. See [implementation status](docs/implementation-status.md) and [Jira requirements](docs/jira-requirements.json). No Figma account is needed.

## Prerequisites

- Node.js **24** and pnpm **11.25.0**, matching `package.json`.
- Docker Engine or Docker Desktop with Compose v2, running with Linux-container support.
- A terminal at the repository root. Commands below work in PowerShell and POSIX shells unless stated otherwise.
- Free ports: **3000** (web), **3001** (API), **55432** (PostgreSQL), **56379** (Redis).
- Network access for the initial package/image downloads.

Install the pinned package manager if needed, then check prerequisites:

```sh
npm install --global pnpm@11.25.0
node --version
pnpm --version
docker compose version
```

Node should report `v24.x`. Start Docker before proceeding.

## First run: local app with Docker databases

Run from the repository root, in this order:

```sh
node scripts/init-local.mjs
pnpm install --frozen-lockfile
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait
pnpm --filter @vcp/database generate
pnpm build
node scripts/database-command.mjs migrate
node scripts/database-command.mjs seed
```

The initializer creates random passwords in `.runtime/database-password` and `.runtime/owner-password`, preserving existing files. `.runtime` is ignored by Git: protect it and never upload its contents. The seed creates login **`owner`** using the owner-password file. Re-running the seed does not reset an existing password.

No `.env` is required for this path. Local scripts read the password file and set database/Redis connection settings. Docker named volumes preserve database and queue data.

Start these in **three separate terminals**, each at the repository root:

```sh
# Terminal 1: API
node scripts/local-server.mjs api
```

```sh
# Terminal 2: background worker
node scripts/local-server.mjs worker
```

```sh
# Terminal 3: web
node scripts/local-server.mjs web
```

Open **[http://localhost:3000/login](http://localhost:3000/login)**. Sign in as `owner`, using the contents of `.runtime/owner-password`. Read the file locally in your editor; do not paste it into issues, screenshots or logs. Use `localhost` in the browser to match the configured origin.

The API health check is [http://127.0.0.1:3001/api/v1/system/health](http://127.0.0.1:3001/api/v1/system/health). `UP` confirms HTTP process liveness, not broker/data/trading readiness. The web app proxies `/api/v1` to the API.

If another project owns port 3000, set `VCP_WEB_PORT=3002` in **all three startup terminals** before launching these commands, then open `http://localhost:3002/login`. PowerShell: `$env:VCP_WEB_PORT='3002'`. POSIX shells: `export VCP_WEB_PORT=3002`. The API keeps port 3001 and its allowed browser origin follows the selected web port. Do not stop unrelated applications just to free port 3000.

## Stop, restart and update

Press **Ctrl+C** in each application terminal. Stop databases without deleting data:

```sh
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop
```

For a normal restart, use the same `up -d --wait` command and restart the three terminals. After code updates, stop the app processes, then run:

```sh
pnpm install --frozen-lockfile
pnpm --filter @vcp/database generate
pnpm build
node scripts/database-command.mjs migrate
```

Restart the API, worker and web afterward. These scripts run **compiled output**, not hot reload. Rebuild after source edits. Preserve the original database-password file while retaining the PostgreSQL volume. `docker compose down -v` deletes stored data; it is not a routine restart command.

## Tests

After installation and build:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Integration tests use a separate **`vcp_test`** database. With local containers running, create it **once**:

```sh
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec postgres createdb -U vcp vcp_test
```

If it already exists, skip creation and retain it. Then:

```sh
node scripts/database-command.mjs test
node --test tests/worker.integration.mjs
```

The first command migrates `vcp_test` and runs PostgreSQL integration checks; the second verifies Redis behavior. Fixtures are synthetic. Never run integration tests against your application or production database.

For web verification, complete the database test first and **stop the normal API/web processes** to free ports 3000/3001:

```sh
node scripts/database-command.mjs test-web
```

This starts temporary API/web processes against `vcp_test`, tests the authenticated flows, then stops them. Restart your normal API/web afterward. [CI](.github/workflows/ci.yml) uses equivalent commands with explicitly isolated connection settings.

For a web-test port conflict, set `WEB_TEST_PORT=3002` before `test-web` (PowerShell: `$env:WEB_TEST_PORT='3002'`; POSIX: `export WEB_TEST_PORT=3002`). Port 3001 must still be free. This override is separate from `VCP_WEB_PORT`, which configures the normal preview.

## Broker setup and historical data

**Broker credentials are not required to start the app or run synthetic tests.** A fresh installation does not silently download data or fabricate passing readiness gates.

Live access requires account/API entitlement, independently verified registered/static outbound IP, source licensing, verified instruments/calendars and encryption keys. Broker requests originate only in the backend.

- [Credential provisioning](docs/broker-credentials.md): protected PIN/TOTP input, `BROKER_KEY_DIRECTORY`, encrypted references and session renewal.
- [Backfill setup](docs/backfill.md): submission input, pinned sources/mappings, bounded downloads and recovery.
- [Historical probes](docs/historical-probes.md): observed coverage, account limits and truncation detection.

The operator provisioning/submission entry points require `DATABASE_URL` and `REDIS_HOST`/`REDIS_PORT` in their environment; they do not automatically use the local-server wrapper's settings. Pass protected input-file **paths**, never credentials as command-line values. Set `BROKER_KEY_DIRECTORY` in the worker environment before startup. Real credentials, encryption keys and verified live datasets are not bundled.

## Configuration

| Setting | Purpose / local behavior |
| --- | --- |
| `DATABASE_URL` | Local wrapper constructs it from `.runtime/database-password`, port 55432, database `vcp` |
| `VCP_WEB_PORT` | Local wrapper's web port and browser origin; defaults to 3000; use the same value in every startup terminal |
| `REDIS_HOST`, `REDIS_PORT` | Local wrapper uses `127.0.0.1`, `56379` |
| `APP_ORIGIN` | Exact CSRF origin; local wrapper uses `http://localhost:3000` |
| `COOKIE_SECURE` | Local loopback API uses `false`; public/production deployments require HTTPS and secure cookies |
| `API_HOST`, `PORT` | API defaults to `127.0.0.1`, `3001` |
| `API_INTERNAL_URL` | Web proxy target; defaults to `http://127.0.0.1:3001`; configure consistently before build/start if changing it |
| `OWNER_LOGIN`, `OWNER_PASSWORD_FILE` | Set by the local seed wrapper |
| `BROKER_KEY_DIRECTORY` | Restricted directory of named encryption keys; unset until provisioned |

For other deployments, inject environment variables and secret files through deployment secret management. The `infra` container/TLS files are an additional deployment path; this README's first-run sequence describes local development, not a production launch procedure.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Docker unavailable | Start Docker Desktop/Engine; confirm `docker info` works. Windows needs Linux containers. |
| Port already in use | Stop the old process using that port. Check existing app terminals before starting a second copy. |
| Missing `.runtime` file | Run `node scripts/init-local.mjs` from the repository root. Preserve existing database secrets. |
| Database password rejected | Restore the original password file used to initialize the persistent volume; do not silently recreate the database. |
| Prisma client/schema mismatch | Stop API/worker/test processes, generate Prisma, rebuild, migrate and restart. |
| Windows Prisma `EPERM` | Stop processes holding the native Prisma engine DLL before generation; check filesystem permissions if it persists. |
| Web has no production build | Run `pnpm build` before web startup. |
| Login fails | Use `owner`, seed once, and read the original owner password. Seed does not reset existing accounts. Repeated failures trigger a one-minute throttle. |
| Login/mutations return 403 | Match the browser URL to `APP_ORIGIN`; check cookie settings and restart after changes. |
| Worker dependency errors | Check `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps`, migrations and Redis. |
| Broker unavailable / empty views | Supply verified source, permission, mapping, calendar and session evidence. Missing inputs remain blocked rather than replaced with demo data. |
| Web tests cannot bind ports | Stop the normal API/web before running `test-web`. |

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Authenticated Next.js UI |
| `apps/api` | Versioned NestJS API and owner authentication |
| `apps/worker` | BullMQ delivery and broker/background orchestration |
| `packages/domain` | Exact decimal/time contracts; separate server-only logging export |
| `packages/market-data` | Broker access, validation, adjustments, calendars and source gates |
| `packages/database` | Prisma schema, migrations and transactional persistence |
| `packages/indicators`, `vcp`, `strategy`, `portfolio`, `backtest` | Shared domain logic |
| `tests`, `fixtures`, `docs` | Verification, synthetic evidence and requirements/contracts |

Financial JSON values are decimal strings, stored timestamps are UTC, and exchange sessions use Asia/Kolkata. Shared rules belong in packages; broker network access belongs only in `market-data`.

AI is not required to run V1. The optional future [AI shadow-review contract](docs/ai-shadow-review.md) is offline and cannot override deterministic trading rules.

After provisioning verified data sources and broker access, use the [incremental synchronization guide](docs/incremental-sync.md) to submit missing-session and three-session-overlap refreshes to the worker.

The worker can also execute [durable correction replay](docs/indicator-replay.md) from stored evidence. Historical RS preparation pins a verified universe, benchmark, member adjustments and strategy profile; the worker then automatically delivers chronological VCP/breakout replay. Migrations 23–25 add context reuse, initial discovery and propagation of peer/benchmark corrections. Missing evidence remains explicitly pending. The linked guide documents setup and recovery. Whole-universe scan materialization remains KAN-73 work.

After migration 26, use **My watchlists** to save canonical instruments and persist symbol/ISIN and exchange filters. [Watchlist setup and API](docs/watchlists.md) explains timestamps, audit records and missing-data status. A verified instrument snapshot is required before instruments appear in the selector; saving a symbol does not alter scanner or trading state.

Migrations 27–28 add the [daily structure coordinator](docs/daily-structure.md) and [EOD scanner](docs/eod-scans.md). After verified inputs and an active strategy profile are present, prepare a finalized scan with `node scripts/database-command.mjs scan YYYY-MM-DD CALENDAR_SHA256`. The running worker dispatches its members and persists checkpoints and results. The scanner guide covers prerequisites, progress endpoints and retry recovery. Calendar-driven automatic scan preparation remains under development.
