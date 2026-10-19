# Implementation status

Scope: KAN-4 through KAN-139 (136 tickets). UI is designed independently as requested. Jira requirements are saved in jira-requirements.json; that original snapshot's statuses are historical.

## Jira status

61 tickets are Coded: KAN-18–20, KAN-22–40, KAN-42–43, KAN-46, KAN-49–59, KAN-61–72, KAN-74–77, KAN-81, KAN-83, KAN-85, KAN-87–91, KAN-128.

75 tickets remain, including epics. In Progress: KAN-4–11, KAN-21, KAN-41, KAN-44–45, KAN-47, KAN-60, KAN-80, KAN-82, KAN-84, KAN-92–94, KAN-122–123, KAN-139. Working status never implies verified completion.

## Implemented areas

- Monorepo, strict TypeScript, versioned API, authentication, CSRF, domain contracts, exact decimals, database constraints, local containers/TLS and CI configuration.
- Verified-calendar raw ingestion, immutable corrections and transactional change outbox; normalized instrument, universe and sector snapshots; source registry and fail-closed readiness gates.
- Indicators, relative strength, market regime, immutable strategy profiles and VCP structural detection/evidence.
- Persisted scan coverage, deterministic candidate ranking, nested pattern evidence and cursor API.
- Immutable breakout/user-decision evidence, structural stops and pure entry eligibility rules.
- Durable cash and actual-fill journal, FIFO costs, reversal/replacement corrections, idempotent API and concurrency protection.
- Authenticated responsive application shell and connected Positions cash/fill/journal interface. Other feature screens remain incomplete.

## Current pipeline work

KAN-36 is Coded. Durable incremental runs fetch missing sessions plus the last three finalized sessions through the existing licensed, budgeted window worker. Windows are bounded to 400 calendar days and commit bars/checkpoints atomically; retries preserve the original plan. The direct all-or-nothing helper remains available separately. Corrected overlap emits immutable version-2 replay requests specifying per-session INDICATORS/MARKET_SIGNALS/VCP/SCANS ordering. Six focused tests and PostgreSQL/Redis integration passed, including one correction, unchanged overlap, duplicate resume, context conflicts and durable replay receipt. Worker dependency build and lint passed. Executing replay remains KAN-60; calendar scheduling remains KAN-21. See incremental-sync.md.

KAN-37 implements immutable split/bonus adjustment snapshots, separate adjusted candles, raw-revision verification and blocking of unverified action evidence. Fractional adjusted volume is preserved separately from integer raw shares. Synthetic unit and PostgreSQL integration verification passed.

KAN-35 now delivers candle changes through BullMQ into immutable PostgreSQL replay requests, including duplicate and lost-queue recovery. Replay stages remain explicitly PENDING; executing them is unfinished KAN-60 work. KAN-30 provides shared Redis request ceilings, and KAN-38 adds the bounded read-only historical transport, retry policy, durable auth circuit and sanitized attempt evidence. KAN-29 now validates lossless daily responses, compares overlapping historical windows and persists immutable account-probe evidence; synthetic verification passed. KAN-28 now implements bounded login/profile authentication, verified account identity, AES-GCM reference storage, atomic session restoration, configured key files and worker credential resolution. Synthetic authentication and circuit-failure integration passed. KAN-32 now persists resumable windows, immutable attempts and atomic candle/checkpoint commits; KAN-39 exposes authenticated job and source-specific coverage APIs. KAN-33 has tested five-year planning, 400-day segmentation and shrinking to a seven-day floor, and now integrates normalized broker responses with transactional checkpoints. Shared-budget deferrals preserve retry delays without consuming the four-failure limit. KAN-33 now has immutable run bindings, a registered production handler and SQL-driven Redis delivery recovery. Live deployment requires genuine provisioned credentials and verified source/calendar/mapping evidence. Production scanner KAN-73, entry integration, live risk, exits, notifications, backtesting, remaining UI and operational launch work remain open. No broker connection, verified live market data, production readiness or completed trading workflow is claimed.

## Verification and runtime

2026-10-19, context discovery: KAN-60 now automatically prepares initial or changed-interval replay context from stored verified evidence. The latest mapping, covering historical universe, G04 proof and supported profile are selected without falling back to older favorable mappings or benchmark proofs. Missing context records WAITING with a typed reason and is reconsidered fairly. Discovered plans are immutable and unique per receipt under concurrent preparation. Build, lint and all three PostgreSQL/Redis integration suites passed, including missing mapping, failed benchmark proof, recovery after valid evidence, concurrent discovery and subsequent split replay. Remaining KAN-60 work is cross-listing dependency propagation and full orchestration; it remains In Progress. Counts remain 61 Coded and 75 remaining.

Migration 24 is applied to both local databases. The VCP worker was restarted with initial context discovery and durable waiting reasons enabled, alongside migration 23's automatic strength-replay handling.

2026-10-19: KAN-60 adds immutable StrengthReplayPlan records and automatic context reuse for a corrected listing with the same historical interval. The registered strength-replay worker reloads pinned evidence; concurrent planning is idempotent, lost queue jobs are recovered, and automatic results never become recursive templates. A split-correction integration fixture verifies EMA/ATR against full recomputation, automatic RS/structure replay, unchanged original evidence and no live market events. Off-tick adjusted pivots now produce UNKNOWN/ADJUSTED_PIVOT_OFF_TICK instead of failing the replay job. The delivery test is scoped to its own listing so accumulated fixtures cannot hide it beyond the query limit. Worker dependency build, lint, focused replay regressions and all three PostgreSQL/Redis integration suites passed. KAN-60 remains In Progress for initial context discovery, changed date ranges and cross-listing dependency orchestration. The earlier 121-test full regression below predates this change.

Previous verification (2026-10-18): immutable historical cross-sectional RS preparation and SQL-to-Redis structure replay passed 121 unit/HTTP tests and three PostgreSQL/Redis integration suites. Context pins verified historical constituents, cash-equity mapping, benchmark proof, adjustment revisions and profile; missing membership stays in the denominator. Each session uses only its prefix, and retrospective evidence remains separate from actual historical availability. The golden fixture reaches BREAKOUT_CONFIRMED without creating live MarketEvent records. Missing context reports PARTIAL/HISTORICAL_RS_UNAVAILABLE.

Durable indicator replay reloads pinned correction, adjustment and calendar evidence. Indicator snapshots and an immutable completion receipt commit atomically; conflicts roll back the batch. Full-seed EMA/ATR recomputation, concurrent duplicates, source gaps, unchanged originals and prefix lineage passed PostgreSQL integration. See indicator-replay.md for the preparation and replay commands. Earlier UI verification below predates this backend-only change.

KAN-139 now has a documented post-V1 authority/audit contract and an offline AI_SHADOW_1 validator. Missing/unknown/future evidence and invalid/unavailable responses cannot imply approval. All four focused tests pass, including preservation of an unreconciled portfolio BUY block; the preceding full suite passed 111 tests, and strategy build plus lint/boundary checks passed. No model service is enabled. The ticket remains In Progress pending actual audit logging and protective-monitor integration acceptance; the contract does not claim those unfinished capabilities.

108 unit/HTTP tests passed; the two Redis integration tests passed again with tracing enabled, plus PostgreSQL integration covering synchronization, immutable adjustments, correction delivery recovery and persistent authentication circuits, stale-lease rollback, window repair/retry exhaustion and coverage APIs. Nineteen migrations are applied to both local databases. Dependency build, strict workspace typecheck and lint passed. All 14 authenticated UI routes passed again on the isolated vcp_test database using web port 3002. The root README now documents first-run setup, owner login, three-process startup, test isolation, port overrides and troubleshooting. KAN-128 adds closed-schema JSON logging, async correlation, broker span/audit linkage and safe failure codes.

CI is configured, but no remote CI run occurred because no Git remote is configured. Tests use synthetic data in isolated vcp_test; no synthetic financial records are inserted into the application database.

Web preview: http://localhost:3002 (VCP_WEB_PORT=3002; port 3000 belongs to another project); API: loopback 3001. The current local worker runs through node scripts/local-server.mjs worker. Docker proxy: https://localhost:8443 with a local CA. The Docker image predates recent pipeline/portfolio work. PostgreSQL and Redis are bound to loopback ports 55432 and 56379.

Ignored .runtime files hold local secrets. Login is owner; the password is in .runtime/owner-password and is never logged. Stop the API and worker before regenerating Prisma on Windows to release its native DLL. Restart preview processes after production builds.
