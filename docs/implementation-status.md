# Implementation status

Scope: KAN-4 through KAN-139 (136 tickets). UI is designed independently as requested. Jira requirements are saved in jira-requirements.json; that original snapshot's statuses are historical.

## Jira status

63 tickets are Coded: KAN-18–20, KAN-22–40, KAN-42–43, KAN-46, KAN-49–72, KAN-74–77, KAN-79, KAN-81, KAN-83, KAN-85, KAN-87–91, KAN-128.

73 tickets remain, including epics. In Progress: KAN-4–11, KAN-21, KAN-41, KAN-44–45, KAN-47, KAN-80, KAN-82, KAN-84, KAN-92–94, KAN-122–123, KAN-139. Working status never implies verified completion.

## Implemented areas

- Monorepo, strict TypeScript, versioned API, authentication, CSRF, domain contracts, exact decimals, database constraints, local containers/TLS and CI configuration.
- Verified-calendar raw ingestion, immutable corrections and transactional change outbox; normalized instrument, universe and sector snapshots; source registry and fail-closed readiness gates.
- Indicators, relative strength, market regime, immutable strategy profiles and VCP structural detection/evidence.
- Persisted scan coverage, deterministic candidate ranking, nested pattern evidence and cursor API.
- Immutable breakout/user-decision evidence, structural stops and pure entry eligibility rules.
- Durable cash and actual-fill journal, FIFO costs, reversal/replacement corrections, idempotent API and concurrency protection.
- Authenticated responsive application shell and connected Positions cash/fill/journal interface. Other feature screens remain incomplete.

## Current pipeline work

KAN-80 remains In Progress. Migration 27 adds an atomic daily structure coordinator that loads the previous stored primary, evaluates/persists its breakout before current detection, and stores immutable execution and pattern evidence. Concurrent duplicate delivery is idempotent; changed same-session inputs are rejected, and detector failure rolls back the event. Missing/late prior state, changed price basis and unavailable RS retain explicit reasons. Source preparation, scheduled scan dispatch and HTTP read exposure remain unfinished. See daily-structure.md.

KAN-36 is Coded. Durable incremental runs fetch missing sessions plus the last three finalized sessions through the existing licensed, budgeted window worker. Windows are bounded to 400 calendar days and commit bars/checkpoints atomically; retries preserve the original plan. The direct all-or-nothing helper remains available separately. Corrected overlap emits immutable version-2 replay requests specifying per-session INDICATORS/MARKET_SIGNALS/VCP/SCANS ordering. Six focused tests and PostgreSQL/Redis integration passed, including one correction, unchanged overlap, duplicate resume, context conflicts and durable replay receipt. Worker dependency build and lint passed. Correction replay is implemented under KAN-60; calendar scheduling remains KAN-21. See incremental-sync.md.

KAN-37 implements immutable split/bonus adjustment snapshots, separate adjusted candles, raw-revision verification and blocking of unverified action evidence. Fractional adjusted volume is preserved separately from integer raw shares. Synthetic unit and PostgreSQL integration verification passed.

KAN-35 now delivers candle changes through BullMQ into immutable PostgreSQL replay requests, including duplicate and lost-queue recovery. Original requests remain immutable; KAN-60 records stage execution in separate immutable receipts and results. Scan materialization remains KAN-73. KAN-30 provides shared Redis request ceilings, and KAN-38 adds the bounded read-only historical transport, retry policy, durable auth circuit and sanitized attempt evidence. KAN-29 now validates lossless daily responses, compares overlapping historical windows and persists immutable account-probe evidence; synthetic verification passed. KAN-28 now implements bounded login/profile authentication, verified account identity, AES-GCM reference storage, atomic session restoration, configured key files and worker credential resolution. Synthetic authentication and circuit-failure integration passed. KAN-32 now persists resumable windows, immutable attempts and atomic candle/checkpoint commits; KAN-39 exposes authenticated job and source-specific coverage APIs. KAN-33 has tested five-year planning, 400-day segmentation and shrinking to a seven-day floor, and now integrates normalized broker responses with transactional checkpoints. Shared-budget deferrals preserve retry delays without consuming the four-failure limit. KAN-33 now has immutable run bindings, a registered production handler and SQL-driven Redis delivery recovery. Live deployment requires genuine provisioned credentials and verified source/calendar/mapping evidence. Production scanner KAN-73, entry integration, live risk, exits, notifications, backtesting, remaining UI and operational launch work remain open. No broker connection, verified live market data, production readiness or completed trading workflow is claimed.

## Verification and runtime

2026-10-19: KAN-80 daily coordinator verification passed: 125 unit/API tests, all three PostgreSQL/Redis integration suites, database dependency build, lint and package-boundary checks. The final tick/input-copy safeguards also passed a rebuild and the four focused daily-structure tests. Migration 27 is applied to both local databases. Synthetic daily executions exist only in vcp_test. This internal service is not yet connected to scheduled production scans, so Jira remains In Progress and the totals remain 63 Coded / 73 remaining.

2026-10-19: KAN-79 is Coded. Authenticated saved watchlists persist owner-scoped canonical listings and filters, with immutable configuration-bound audit records. The connected watchlists page supports create/select/add/remove/filter actions and displays timestamps and explicit unknown research status. Mutations do not change scanner or detector snapshots. API/web builds, lint, all three PostgreSQL/Redis integration suites and all 15 authenticated UI route checks passed. Integration covers CSRF, owner isolation, duplicate concurrent additions, canonical mapping validation, removal idempotency and immutable audit evidence. Migration 26 is applied to both local databases; API and web preview have been restarted. See watchlists.md and the root README for usage and setup. No remote CI run is claimed.

2026-10-19: KAN-60 is Coded. The worker executes stored indicator correction replay, discovers or reuses verified RS context, reconstructs VCP/breakout evidence chronologically, and propagates changed peer or verified benchmark dependencies into new immutable results. Own-candle revisions remain bound to their receipt. Duplicate/concurrent planning is idempotent, missing Redis jobs are recovered, and bounded failures retain their state. Missing evidence and off-tick adjusted pivots retain explicit reasons; original market events, decisions and fills are preserved.

Verification: all 121 unit/API tests, all three PostgreSQL/Redis integration suites, worker dependency build, lint and package-boundary checks passed. Integration covers old-candle/full recomputation equivalence, split corrections, initial context discovery, latest failed benchmark proof, peer RS changes, stale benchmark-proof blocking and recovery, duplicate-plan prevention, and preservation of original replay evidence. Migration 25 is applied to both local databases; the updated worker resumed successful polling on 2026-10-19. CI includes these suites, but no remote CI run is claimed.

Whole-universe scanner/materialization remains KAN-73. Historical replay requires verified evidence covering the interval; unavailable or unsupported contexts fail closed. This completion does not establish live broker readiness or complete the remaining application workflows. See indicator-replay.md for preparation, recovery and dependency details. Earlier UI verification below predates this backend change.

KAN-139 now has a documented post-V1 authority/audit contract and an offline AI_SHADOW_1 validator. Missing/unknown/future evidence and invalid/unavailable responses cannot imply approval. All four focused tests pass, including preservation of an unreconciled portfolio BUY block; the preceding full suite passed 111 tests, and strategy build plus lint/boundary checks passed. No model service is enabled. The ticket remains In Progress pending actual audit logging and protective-monitor integration acceptance; the contract does not claim those unfinished capabilities.

108 unit/HTTP tests passed; the two Redis integration tests passed again with tracing enabled, plus PostgreSQL integration covering synchronization, immutable adjustments, correction delivery recovery and persistent authentication circuits, stale-lease rollback, window repair/retry exhaustion and coverage APIs. Nineteen migrations are applied to both local databases. Dependency build, strict workspace typecheck and lint passed. All 14 authenticated UI routes passed again on the isolated vcp_test database using web port 3002. The root README now documents first-run setup, owner login, three-process startup, test isolation, port overrides and troubleshooting. KAN-128 adds closed-schema JSON logging, async correlation, broker span/audit linkage and safe failure codes.

CI is configured, but no remote CI run occurred because no Git remote is configured. Tests use synthetic data in isolated vcp_test; no synthetic financial records are inserted into the application database.

Web preview: http://localhost:3002 (VCP_WEB_PORT=3002; port 3000 belongs to another project); API: loopback 3001. The current local worker runs through node scripts/local-server.mjs worker. Docker proxy: https://localhost:8443 with a local CA. The Docker image predates recent pipeline/portfolio work. PostgreSQL and Redis are bound to loopback ports 55432 and 56379.

Ignored .runtime files hold local secrets. Login is owner; the password is in .runtime/owner-password and is never logged. Stop the API and worker before regenerating Prisma on Windows to release its native DLL. Restart preview processes after production builds.
