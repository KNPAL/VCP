# Implementation evidence

Scope: KAN-4 through KAN-139 (136 tickets). User authorized independent UI design; Figma access is no longer a dependency. Requirements snapshot: jira-requirements.json. Ticket status is updated when work starts and when verified implementation is coded. No broker orders are permitted.

## Verified code

- KAN-18: pnpm monorepo, strict TypeScript, all app/package boundaries.
- KAN-20: versioned NestJS API, health, typed failures, correlation, OpenAPI 3.1.
- KAN-22: PostgreSQL 17 migrations, seed harness, UUID/timestamp/decimal constraints, append-only evidence.
- KAN-23: persistent single-owner sessions, scrypt passwords, secure HttpOnly SameSite cookies, origin and CSRF checks, login throttling, logout and expiry.
- KAN-24: shared wire contracts and state enums, decimal strings, UTC/session validators and error mappings.
- KAN-25: exact decimal/tick/share/session utilities.
- KAN-51–58: exact rational SMA/EMA, Wilder ATR, volume ratios, strict Trend Template, aligned RS, percentile coverage/ties, market regime and raw-turnover median. Every series result includes source revision and as-of evidence. Raw and adjusted price scales cannot be interchanged.
- KAN-61–72: confirmed 3/3 extrema, ambiguity and normalization, pretrend/base/leg rules, frozen full-base pivots, READY lifecycle, stable identity, nested selection, signal deduplication, immutable persisted chart evidence and corporate-action supersession, golden fixture/replay tests.

The Jira transition batch for KAN-51–58 and KAN-61–72 is being completed; tool results are authoritative. No remote CI has run because there is no configured Git remote.

## Work in progress

- KAN-19: full Compose stack (Postgres, Redis, migrations, API, web, worker, nonroot TLS proxy). App services passed container health checks. TLS hostname/health-check revision is being verified. Docker's first export failed; a retry built successfully.
- KAN-21: independent BullMQ runtime, scheduler requiring verified finalized sessions, deduplicated jobs, failed-job handling and fenced ownership primitives. Redis integration test passes. Production scan/gateway handlers still need integration.
- KAN-27: independently designed responsive authenticated shell; navigation, loading/error boundaries, login/logout and setup routes. All 14 routes passed real HTTP authentication/rendering tests. UI features remain placeholders until their own tickets are implemented.
- KAN-59: immutable configuration/hash and append-only point-in-time activation; persistence tests underway.
- KAN-60: append-only indicator snapshots, idempotent persistence and forward recomputation from the original EMA/ATR seed. Correction tests pass. Worker-level VCP/signal correction replay integration remains.
- KAN-4 and KAN-7 epics remain in progress; cross-module acceptance must pass before closing epics.

## Verification

31 combined unit/HTTP tests passed before the latest profile test was added. Additional PostgreSQL integration verifies migrations, financial CHECK constraints, retry deduplication, retained original indicator/pattern revisions, supersession and authentication. Redis integration verifies duplicate job suppression, unknown job failure and ownership fencing. Full workspace build and strict typecheck pass; package-boundary checks pass. Tests use synthetic fixtures, never live trading data.

## Local runtime

- http://localhost:3000: standalone web preview; API on loopback port 3001.
- Docker stack: https://localhost:8443 (local CA; system trust is not automatically modified).
- PostgreSQL dev port 55432, Redis dev port 56379, both bound to loopback.
- Local secrets are generated under .runtime and ignored by Git. Login owner; password is in .runtime/owner-password and is never printed in logs.
- node scripts/database-command.mjs migrate / seed / test handles local secrets without placing them in command arguments.
- tests/database.integration.mjs uses isolated vcp_test, never the application database.
- On Windows, stop the local API before regenerating Prisma, because the loaded native engine locks its DLL.
- Local preview servers must restart after a production build to avoid stale route code.

## Remaining scope

Most tickets remain unimplemented: broker integration and data ingestion/readiness, whole-universe scans, entry plans, portfolio/fills/risk, exit monitoring, live transport/notifications, historical portfolio backtesting, functional feature screens, operational deployment/backup/DR/performance, IPO/SME research and launch review. No production readiness, brokerage connection, verified live data, or usable trading workflow is claimed. Placeholder screens are not completion of KAN-118–127.

Next: finish current foundation verification/statuses, integrate correction replay, then implement scan/signal/portfolio services and their real UI views. Keep all incomplete tickets out of Coded.
