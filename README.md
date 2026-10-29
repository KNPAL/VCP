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

Automatic EOD preparation is optional. After configuring verified calendar/readiness evidence, set `$env:VCP_ENABLE_EOD_SCHEDULER='true'` before starting the worker in PowerShell, or run `node scripts/local-server.mjs scheduler` in a fourth terminal alongside the worker. The [scheduler guide](docs/scheduler.md) explains lease fencing, waiting reasons and deployment modes. Authenticated status is available at `/api/v1/system/scheduler`.

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

For a focused rerun, append one or more suite names: `node scripts/database-command.mjs test database scheduler`. Supported names are `database`, `eod-scan`, `indicator-replay`, `rs-replay`, and `scheduler`; the database remains isolated as `vcp_test`.

For web verification, complete the database test first and **stop the normal API/web processes** to free ports 3000/3001:

```sh
node scripts/database-command.mjs test-web
```

This starts temporary API/web processes against `vcp_test`, tests the authenticated flows, then stops them. Restart your normal API/web afterward. [CI](.github/workflows/ci.yml) uses equivalent commands with explicitly isolated connection settings.

For a web-test port conflict, set `WEB_TEST_PORT=3002` before `test-web` (PowerShell: `$env:WEB_TEST_PORT='3002'`; POSIX: `export WEB_TEST_PORT=3002`). Port 3001 must still be free. This override is separate from `VCP_WEB_PORT`, which configures the normal preview.

## Broker setup and historical data

**Broker credentials are not required to start the app or run synthetic tests.** A fresh installation does not silently download data or fabricate passing readiness gates.

Live access requires account/API entitlement, independently verified registered/static outbound IP, source licensing, verified instruments/calendars and encryption keys. Broker requests originate only in the backend.

- [Broker health and reconnect](docs/broker-health.md): shared status, readiness expiry, download gating and stored-data access during outages.
- [Interactive broker login lifecycle](docs/broker-login.md): HTTPS login/logout APIs, required runtime keys/network proof, persisted rate limits and remaining acceptance work.
- [Broker configuration](docs/broker-configuration.md): encrypted setup API, HTTPS/key requirements and current integration limitations.
- [Credential provisioning](docs/broker-credentials.md): protected PIN/TOTP input, `BROKER_KEY_DIRECTORY`, encrypted references and session renewal.
- [Backfill setup](docs/backfill.md): submission input, pinned sources/mappings, bounded downloads and recovery.
- [Historical probes](docs/historical-probes.md): observed coverage, account limits and truncation detection.
- [Universe and data health](docs/data-health.md): stored coverage, scan progress, source gates, broker status and manual download/retry controls.
- [BUY signals](docs/buy-signals.md): persisted breakout evidence, current broker-bound entry eligibility, plan revalidation and the authenticated signal API.
- [Surveillance and tradability](docs/surveillance.md): import licensed per-listing ASM/GSM/ESM, price-band and cash-tradability evidence for G06.
- [Preview authorization](docs/download-authorization.md): optional protected signing-key setup, five-minute owner/evidence binding and remaining download submission work.
- [Manual downloads](docs/manual-downloads.md): opt-in submission, job history, cancellation and retry setup, migration requirements and remaining delivery verification.

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

The worker can also execute [durable correction replay](docs/indicator-replay.md) from stored evidence. Historical RS preparation pins a verified universe, benchmark, member adjustments and strategy profile; the worker then automatically delivers chronological VCP/breakout replay. Migrations 23–25 add context reuse, initial discovery and propagation of peer/benchmark corrections. Missing evidence remains explicitly pending. The linked guide documents setup and recovery. The EOD scanner described below materializes new daily scans; retrospective replay does not overwrite live scans.

After migration 26, use **My watchlists** to save canonical instruments and persist symbol/ISIN and exchange filters. [Watchlist setup and API](docs/watchlists.md) explains timestamps, audit records and missing-data status. A verified instrument snapshot is required before instruments appear in the selector; saving a symbol does not alter scanner or trading state.

Migrations 27–29 add the [daily structure coordinator](docs/daily-structure.md), [EOD scanner](docs/eod-scans.md), and optional [calendar scheduler](docs/scheduler.md). After verified inputs and an active strategy profile are present, prepare a finalized scan manually with `node scripts/database-command.mjs scan YYYY-MM-DD CALENDAR_SHA256` or enable the scheduler. The running worker dispatches preparation/member jobs and persists checkpoints and results. The guides cover prerequisites, progress endpoints and retry recovery.

New EOD plans include durable market-regime evidence with benchmark and breadth source revisions. Rebuild/restart API and worker to load this update; no additional migration is required. Existing plans remain unchanged and return no regime evidence. The scan-job progress endpoint exposes the historical result; entry-plan sizing now verifies current sessions and source revisions before consuming it.

The **VCP screener** now displays stored ranked scans, state filters, contraction evidence, coverage and immutable cursor pagination. It supports saving instruments and state filters to research watchlists. See [screener usage and verification](docs/screener.md). Without a stored scan, the screen explicitly shows UNKNOWN; it never inserts demo financial data.

Use **Settings** to inspect ST_VCP_4_0 rules, immutable configuration hashes and activation history, or save a new draft version. Saving never changes the active strategy or historic scans. See [strategy settings](docs/strategy-settings.md) for supported execution versus draft versions.

Migration 30 adds a [transactional alert outbox](docs/alert-outbox.md). The worker delivers local in-app records with bounded retries and crash recovery. External email/browser delivery adapters remain separate work; no broker orders are submitted.

Migration 31 adds [immutable pattern lifecycle history](docs/pattern-lifecycle.md), including WATCH/READY transitions and deduplicated local alerts. Historical corrections preserve the original live observations.

The worker now provides a [validated live quote cache](docs/live-quotes.md) with exact prices, source freshness, session expiration and fenced reconnects. Held-position monitoring uses this cache as described below; the live broker subscription transport remains separate work.

Migration 32 enables [held-position monitoring](docs/position-monitor.md) automatically in the worker. **My positions** shows feed outages and retained recovery gaps. Set `VCP_STREAM_OWNER` only when the matching live stream owner is provisioned; absent sources remain explicitly degraded.

Migration 33 adds [manual broker-statement reconciliation](docs/reconciliation.md) in **My positions**. Compare all outside holdings, fills and cash with the journal. Matches are timestamped evidence and are invalidated by journal changes; other trading readiness and risk gates still apply.

Migration 34 adds [initial protective stops and SELL observations](docs/protective-stops.md). Actual BUY entries retain the known structural stop; verified fresh ticks can create durable alerts, while fills remain manual. Missing pre-BUY structure or current corporate-action coverage remains UNKNOWN.

Migration 35 adds [portfolio valuation snapshots](docs/portfolio-risk.md) and the authenticated `/api/v1/portfolio/risk` endpoint. **My positions** shows current verified exposure, stop-level downside and missing-input reasons. Apply migrations and restart API, worker and web after building. Snapshots expire within 30 seconds and are invalidated by journal changes; entry plans remain blocked pending their remaining evidence integrations.

Migration 36 adds the [entry-plan audit API](docs/portfolio-risk.md#entry-plan-audit-api). Requests select existing market events and valuation snapshots; the server retains available cap calculations and explicit blocking reasons. Plans remain blocked while broker/readiness and live candidate evidence integrations are unfinished. Apply migrations and rebuild/restart API and worker to load this backend update.

Migration 37 connects [three-loss cooldown protection](docs/loss-streak.md) to risk and entry-plan evaluation. **My positions** now supports attributing fees and corporate-action cash to actual position episodes, with immutable allocation history. Apply migrations and rebuild/restart API, worker and web. The loss-streak gate participates in complete entry eligibility; missing or expired broker/readiness evidence blocks approval.



Entry-plan audit records now include source-backed benchmark, sector, reconciliation and quantity-limit gates. Rebuild/restart the API after updating the portfolio and database packages; no new migration is required. BUY eligibility now requires session-bound broker/heartbeat evidence, a fresh candidate quote and current per-listing surveillance, in addition to these gates. Configure the licensed sources and broker session before expecting approval; missing evidence remains UNKNOWN. See [BUY signals and API](docs/buy-signals.md) for isolated verification and immutable retry semantics. These workspace changes require rebuild/restart and are not present in the existing deployment.
Migration 38 adds an isolated, append-only offline AI shadow audit. Apply migrations with the documented database command and rebuild the database/API/worker packages. No AI credentials, provider, public endpoint or monitoring dependency is introduced. See [AI shadow review](docs/ai-shadow-review.md).
Migration 39 adds [EMA21 trailing stops](docs/position-trailing.md). Apply migrations before starting the rebuilt API/worker. Current stops remain active until next-session updates become effective; no alert creates a fill. The worker evaluates protective stops before EOD work.

Migrations 40–41 add [breakout-failure and partial-profit evidence](docs/position-exits.md), including owner dismissal and actual-fill resolution. Run the documented migration command before starting the updated application. Integration tests require Docker Desktop's Linux engine and the PostgreSQL container to be running; a stopped engine can surface as a Prisma schema-engine error.

Migration 42 adds primary exit decisions and actual-closure resolutions. [Manual top-ups](docs/manual-topups.md) use remaining FIFO lots and retain actual risk-breach evidence; proposal validation does not execute trades.

Migration 43 adds [position lifecycle and monitoring history](docs/position-lifecycle.md). Apply it before starting the updated API/worker. The Positions view separates actual fill state, monitoring health and recommendation; unavailable or expired inputs cannot display a current HOLD.

The worker includes an optional [single-owner SmartAPI live stream](docs/live-stream-owner.md), disabled by default. The guide covers encrypted feed credentials, account configuration, subscription limits and Docker/local startup. Reauthenticate older broker sessions to capture a feed token; no additional migration is required.

Migration 44 adds [authenticated browser updates and REST replay](docs/browser-stream.md). Apply it before starting the rebuilt API/web. The Updates control restores missed events on reconnect; live prices remain separately validated and are never replayed from history. Configure the API's Redis connection and stream account only when enabling quote fanout.

Historical replay archives: see [snapshot selection and operator commands](docs/historical-snapshots.md). Migration 45 adds immutable snapshot storage.

Daily historical detector replay and immutable event inspection: [operator commands and limitations](docs/historical-chronology.md). Migration 46 is required. This records research events; portfolio-wide FIFO coordination and performance reporting remain separate work.

Historical next-open entry simulation: [cost assumptions, risk gates and operator command](docs/historical-entry.md). Migration 47 is required. Simulated decisions are stored separately from actual fills.

Historical stop-first daily exit simulation: [rules, source binding and operator command](docs/historical-exits.md). Migration 48 is required. Intraday proceeds cannot fund opening entries; FIFO coordination remains KAN-115 work.

Historical paper portfolio: [setup, session JSON and CLI commands](docs/paper-ledger.md). Migrations 49–52 add immutable paper ledgers, next-session protection plans, opening exits and atomic session results. The session runner applies opening exits before entries and rolls back all phase changes if a session fails.

Paper performance reports: [metrics, cutoff behavior and CLI usage](docs/paper-performance.md). Reports include FIFO realized P&L, neutral-inclusive win rate, initial-R expectancy, equity/exposure curves, drawdown and explicit data limitations.

Frozen backtest regression and walk-forward comparison: [fixture runner, warm-up ranges and chronological run plans](docs/golden-walk-forward.md). Run `node scripts/golden-backtest.mjs` after building the workspace.

Dashboard: open /dashboard after signing in. See [dashboard evidence and verification](docs/dashboard.md) for scan coverage, regime freshness, portfolio values and alert behavior.

Chart inspector: open /inspector or follow a screener row's inspector link. See [chart evidence, price scales and verification](docs/inspector.md).

My Positions now includes [actual position cards](docs/position-cards.md) with FIFO costs, verified marks, P&L, stops, EMA21 and initial-R metrics.

Select a position card's ISIN for [immutable position detail and manual-sale guidance](docs/position-detail.md).

The [prioritized SELL screen](docs/sell-alerts.md) separates pending exit evidence, review acknowledgement and actual execution.

[IPO research](docs/ipo-research.md) uses reviewed listing facts and at least 30 finalized sessions, with live BUY permanently blocked for this research profile.

[SME research](docs/sme-research.md) keeps lot, liquidity, restrictions and source permissions explicit and never grants live BUY eligibility.

Backtest results: [stored-run results and historical drilldown](docs/backtest-results.md) (includes strategy/source selection and training, validation and out-of-sample comparison of stored runs).

Optional research comparator: [exact 100-day breakout, licensed-source gates and UNKNOWN proxy rules](docs/proxy-research.md).

For an API test-port conflict, set `WEB_TEST_API_PORT` (for example `3101`) and `WEB_TEST_PORT` (for example `3102`). Build the web app with `API_INTERNAL_URL=http://127.0.0.1:3101` for that test run because Next.js stores HTTP rewrites at build time. Rebuild with your normal API origin before returning to normal local use. The test harness waits for the web authentication proxy to return 401 before starting tests. Do not stop unrelated applications to free their ports.

[Instrument-master import](docs/instrument-master.md) (migration 63) normalizes a licensed SmartAPI JSON file against reviewed identities and tick units, with immutable partial-import and retry reports. Apply migrations and rebuild market-data/database before running the import CLI. Missing or ambiguous mappings remain unavailable; this workflow does not acquire data or infer a license.

[Source registry and readiness setup](docs/registry-readiness.md) explains how to import reviewed permission metadata and bind G07 to current source records. Inspector charts and correction replay require current rights for their actual candle providers, even for historical results. Missing grants keep those operations unavailable; local test grants are not production authorization.
