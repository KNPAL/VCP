# Study Trade VCP

Indian-equities research and manual-trade tracking application implementing `ST_VCP_4_0`, using Next.js, NestJS, PostgreSQL, Redis and BullMQ. **It does not place broker orders.**

The local setup runs the web application, API, worker, PostgreSQL and Redis. You can sign in and open the research screens with an empty database. Market data, signals and portfolio readiness depend on verified inputs, so a fresh installation shows empty results or `UNKNOWN`. See [implementation status](docs/implementation-status.md) and [Jira requirements](docs/jira-requirements.json). No Figma account is needed.

## Prerequisites

NSE cash-equity holiday facts for **2015–2026** are included as a reproducible dataset. See [NSE holiday import](docs/nse-holidays.md) for importing the 231 dates into VCP and inspecting the database. This includes weekend observances and distinguishes Muhurat sessions; it does not yet provide the complete operational session calendar required for historical downloads.

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

Run these commands in PowerShell from `D:\Codex\VCP` (or your checkout directory):

```powershell
cd D:\Codex\VCP
node scripts/init-local.mjs
pnpm install --frozen-lockfile
pnpm --filter @vcp/database generate
pnpm build
node scripts/start-local.mjs
```

The last command starts PostgreSQL/Redis, applies database migrations, seeds the owner if needed, and runs the API, worker and web together. Wait for the web server to report ready. Keep this terminal open. For later starts, only `node scripts/start-local.mjs` is needed unless code or dependencies changed.

If you previously started the full VCP Docker application, stop its application services first to avoid running two workers against the same database:

```powershell
docker compose -p study-trade-vcp -f infra/compose.yml -f infra/compose.dev.yml -f infra/compose.app.yml stop api web worker proxy
```

This retains PostgreSQL, Redis and stored data. Do not stop your unrelated Swing-Trading-Application. If port 3000 is occupied, set `$env:VCP_WEB_PORT='3002'` before starting VCP, and use `http://localhost:3002/login`. Port 3001 must also be free.

Open **[http://localhost:3000/login](http://localhost:3000/login)**. Sign in as **`owner`** using `.runtime/owner-password` in this checkout. Read that file locally in your editor. An existing owner's password is preserved by seeding.

**No `.env` edits are needed for this local startup.** The initializer preserves existing passwords and generates missing encryption keys in `.runtime/broker-configuration.key` and `.runtime/broker-keys`. The launcher supplies their paths to both API and worker. Keep `.runtime` private and backed up alongside your database: losing or replacing the encryption keys makes existing broker credentials/sessions unreadable. Never upload these files or paste their contents into logs.

### Find your next step

After login, **Start here** shows the broker, stock setup, download and research stages. The sidebar has direct **Download stocks** and **Download progress** links. Broker login does not create the stock list. Empty chart, screener and backtest screens explain their prerequisites and link back to setup. Missing data remains unverified; the UI does not fabricate records to populate controls.

### Configure Angel One

After login, open **Configuration** in the sidebar, or [http://localhost:3000/configuration](http://localhost:3000/configuration). Substitute your selected web port if different.

1. Check that the first three **Startup checks** show **Ready**. Live streaming is optional and initially disabled.
2. Under **Broker network settings**, enter:
   - **Server public IPv4:** the actual outbound public IP of the machine/network running the API. Confirm it with your ISP/network administrator and register the same address in your SmartAPI app settings. A private address such as `192.168.x.x` is not this value. A static public IP comes from your ISP/cloud/network provider; entering an IP here does not make it static.
   - **Server local IP** and **Server MAC address:** the adapter used by that server. The suggested values may need correction if you use VPNs, virtual adapters or multiple network cards. On Windows, inspect `ipconfig /all`; do not copy another machine's values.
   - **Verification reference:** your actual ISP/cloud/network confirmation and SmartAPI registration reference.
   - **Verified at / Verification expires:** when you checked this evidence and when it must be rechecked. Verification must be in the past, with expiry in the future. Dates display in your local timezone and are stored in UTC. Do not invent verification or expiry evidence simply to clear a warning.
3. Confirm the checkbox and click **Save network settings**. Values persist in PostgreSQL; no network JSON file or `.env` edit is required. Changing these values disconnects the existing broker session and pauses its downloads.
4. In the same screen, enter the **SmartAPI API key** and **Angel One client code**, then **Save broker details**. Credentials are encrypted on the server.
5. Enter the current **Angel One PIN** and **six-digit authenticator code**, then **Connect to Angel One**. PIN and authenticator code are cleared after submission and are not stored as configuration.
6. Confirm the broker session becomes **CONNECTED**. This does not automatically approve market-data permissions, historical-download readiness or live-stream readiness. Those controls retain their separate requirements.

**Fix for “The request was not permitted. Use HTTPS…”:** stop older VCP processes, rebuild, and start with the launcher above. It explicitly enables broker HTTP operations only for development on loopback interfaces. Open the exact `http://localhost:<port>` address printed by the launcher, then sign out/in to refresh the session. Do not mix `localhost`, `127.0.0.1`, different ports or stale tabs. Direct API starts do not enable this exception by default. Production and remote deployments still require HTTPS.

### Server-only configuration

These settings belong in the **process/container environment**, not in the browser Configuration form. The local launcher sets encryption and transport values automatically; it does not automatically load a `.env` file.

| Setting | Local behavior / hosted requirement |
| --- | --- |
| `VCP_BROKER_CONFIGURATION_KEY_FILE` | Local: `.runtime/broker-configuration.key` (raw 32-byte key). Hosted: mount a protected existing key and set its absolute path. |
| `BROKER_KEY_DIRECTORY` | Local: `.runtime/broker-keys`. Hosted: mount the protected directory containing base64 session keys. |
| `VCP_BROKER_SESSION_KEY_ID` | Local: `local-v1`, selecting `local-v1.key`. Hosted: select the mounted session key ID. |
| `VCP_BROKER_NETWORK_FILE` | Optional legacy server JSON fallback; owner settings saved in Configuration take precedence. |
| `VCP_ALLOW_LOCAL_BROKER_HTTP` | Set by local launcher; effective only in development with loopback socket/host and local origin. Never substitutes for hosted HTTPS. |
| `APP_ORIGIN`, `COOKIE_SECURE` | Launcher sets the selected localhost origin and local cookies. Hosted: exact HTTPS origin and secure cookies. |
| `VCP_TRUSTED_PROXY_IPS` | Hosted only: explicit trusted reverse-proxy addresses when TLS terminates at a proxy. Do not trust arbitrary forwarded headers. |
| `VCP_ENABLE_LIVE_STREAM` | Optional explicit `true` in API/worker startup environment; readiness gates still apply. |

For local optional streaming, set `$env:VCP_ENABLE_LIVE_STREAM='true'` **before** `node scripts/start-local.mjs`. Restart after changing process environment. The Configuration screen reports readiness but deliberately does not expose server encryption keys or infrastructure credentials.

The API health check is [http://127.0.0.1:3001/api/v1/system/health](http://127.0.0.1:3001/api/v1/system/health). `UP` confirms HTTP process liveness, not broker/data/trading readiness. The web app proxies `/api/v1` to the API.

Automatic EOD preparation is optional. After configuring verified calendar/readiness evidence, set `$env:VCP_ENABLE_EOD_SCHEDULER='true'` before starting the worker in PowerShell, or run `node scripts/local-server.mjs scheduler` in a fourth terminal alongside the worker. The [scheduler guide](docs/scheduler.md) explains lease fencing, waiting reasons and deployment modes. Authenticated status is available at `/api/v1/system/scheduler`.

If another project owns port 3000, set `VCP_WEB_PORT=3002` in **all three startup terminals** before launching these commands, then open `http://localhost:3002/login`. PowerShell: `$env:VCP_WEB_PORT='3002'`. POSIX shells: `export VCP_WEB_PORT=3002`. The API keeps port 3001 and its allowed browser origin follows the selected web port. Do not stop unrelated applications just to free port 3000.

## Download daily history

After signing in, open **Universe & Data** and choose **Set up historical download**. Select the NIFTY 500, a saved list, or individual stocks. Choose an inclusive date range and preview stored coverage. The wizard uses the latest session verified for every selected stock. If that date is unknown, supply calendar and provider evidence or select stocks with verified dates.

**Missing sessions only** skips candles already stored. **Reconcile** also checks the latest three finalized sessions. Connect Angel One and select **Start download** to follow the background job. The local initializer creates a dedicated `.runtime/download-preview.key` and the local launcher enables manual downloads on both API and worker. An explicit environment override can disable them. No additional `.env` edit is required. Hosted deployments still configure these separately; see [manual download configuration](docs/manual-downloads.md).

**An empty installation has no bundled stock master, NIFTY 500 membership or verified exchange calendar.** Angel One login does not import them. The wizard now reports missing setup instead of leaving an unexplained disabled entry button. Reviewed source-permission records, instrument mappings, universe membership, calendar and provider final-session evidence are required before a real download can start. `View past downloads` is navigation to existing jobs; it never starts one. A verified broker login records its authentication readiness automatically, but does not grant data permissions.

## Stop, restart and update

Press **Ctrl+C** in the launcher terminal (or each terminal if you started processes separately). Stop databases without deleting data:

```sh
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop
```

For a normal restart, run `node scripts/start-local.mjs`. After code updates, stop the app processes, then run:

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

For a focused rerun, append one or more suite names: `node scripts/database-command.mjs test database scheduler`. Suite names correspond to the integration tests registered in [the database command wrapper](scripts/database-command.mjs); examples include `database`, `eod-scan`, `indicator-replay`, `rs-replay`, `scheduler` and `entry-acceptance`. The database remains isolated as `vcp_test`.

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

Portfolio, dashboard, saved-plan and historical-result views also check current permissions for their original source evidence. A `403` or `BLOCKED_DATA` response after setup can indicate missing, expired or revoked grants, or missing lineage in an older record. Follow the source-registry guide to provide reviewed metadata; restarting the application does not replace that evidence. To verify these paths with synthetic fixtures, run `node scripts/database-command.mjs test entry-acceptance eod-scan backtest-results` after building the workspace. The main database, entry and EOD suites create and remove temporary schemas within `vcp_test`; their test database user needs schema creation permission.

Direct candle imports, including quarantined data, require current DAILY_CANDLES STORE permission. Creating adjusted candles also requires DERIVE permission for the original raw source. A worker reports `SOURCE_PERMISSION_REQUIRED`, `SOURCE_SCOPE_AMBIGUOUS` or `SOURCE_LINEAGE_MISSING` when these checks fail; it releases the current lease without committing candles or advancing the checkpoint. Correct the reviewed source metadata before retrying through the normal download workflow. Historical dates and previously successful imports do not bypass current permission checks.

Saving quote-bearing portfolio risk snapshots and entry plans requires LIVE_QUOTES STORE and DERIVE rights, separately from candle and display permissions. A plan submission or retry can return HTTP 403 after a permission change. No-quote snapshots remain available, and permission failures do not create or modify actual fills. See the source-registry guide for the remaining rollout limits.

## Operations dashboard

Open **Operations** after signing in to inspect G01–G10, hourly broker errors, historical queue delays, the last finalized session, scan coverage, held-position feed age and outstanding SELL deliveries. The page refreshes its metrics every 30 seconds. A failed or unknown gate blocks the readiness result.

The API reads optional host settings. Set `VCP_MONITORED_VOLUME` to the mounted volume to measure its free space. The default warning threshold is 10 percent; override with `VCP_DISK_WARNING_PERCENT`. Set `VCP_SCAN_PUBLICATION_SLA_SECONDS` to your publication target. Point `VCP_BACKUP_STATUS_FILE` at a receipt written by your backup process, containing `{"state":"SUCCESS","completedAt":"2026-11-05T03:00:00Z"}` or a recorded `FAILED` result. Missing evidence appears as UNKNOWN. Receipt times identify the last observed backup result.

## Alert delivery

Open **Alert inbox** after signing in. Apply the database migrations and run the API, web app and worker. In-app delivery is enabled by default. To receive desktop alerts while the workspace is open, enable browser notifications in the inbox and grant permission in the browser. Review the source time and quantity before acknowledging or dismissing a signal.

Email is optional. Set `VCP_ALERT_EMAIL_OWNER` to the application's owner UUID in both the API and worker environments. In the worker, set `VCP_ALERT_EMAIL_TO` to the owner's address, `VCP_ALERT_EMAIL_FROM` to a verified Resend sender, and `VCP_ALERT_EMAIL_KEY_FILE` to a server-readable secret file with a sending key. Container deployments must mount that file into the worker. Restart the affected services, then opt in from the inbox. The email timestamp records provider acceptance. Delivery attempts use a stable event key and stop after four attempts. See [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

For G04, the licensed NIFTY 500 price-index reference, calendar and independent review must be available before enabling trade readiness. See [benchmark verification](docs/registry-readiness.md#g04-benchmark-verification) for the import command and evidence fields.

For local regression checks, clean-stack verification and reproducible performance measurements, see [verification and CI](docs/verification.md). Hosted CI is a separate acceptance step; local passing results do not replace it.

Reference-data imports require registered sources for instrument masters, universes, sectors and IPO/SME metadata. Existing snapshots without that binding show unavailable/UNKNOWN data until reviewed reimport. See [reference metadata permissions](docs/registry-readiness.md#reference-metadata-permissions), then rebuild and restart the services after updating.

Exchange-calendar imports also require a registered `EXCHANGE_CALENDAR` source ID on every calendar day. Legacy calendars and historical archives without source lineage remain unavailable until reviewed reimport. See [calendar and archived reference permissions](docs/registry-readiness.md#calendar-and-archived-reference-permissions) before loading data.
