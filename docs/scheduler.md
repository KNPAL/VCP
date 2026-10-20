# Worker and exchange-calendar scheduler

Migration 29 adds a durable scheduler lease, last-observation status, immutable scheduled requests, and preparation dispatch state. The API only exposes authenticated status; it never computes a scan or calls a data provider.

## Start

Build the API and worker dependencies and apply migrations with the root README commands. Automatic preparation is opt-in, so a fresh installation does not start scans with unconfigured sources. Run one of these modes:

```powershell
# Scheduler within the normal worker process
$env:VCP_ENABLE_EOD_SCHEDULER='true'
node scripts/local-server.mjs worker
```

```powershell
# Or a separate scheduler process, alongside the normal worker
node scripts/local-server.mjs scheduler
```

The standalone scheduler does not process queue jobs; keep the worker running. The container wrapper supports the `scheduler` mode, and the Compose worker accepts `VCP_ENABLE_EOD_SCHEDULER=true`. Both modes use the same PostgreSQL lease, so accidentally running both cannot create duplicate session requests.

## Calendar and readiness

Every five seconds, the active owner reads the latest stored calendar snapshot. The current date is computed in IST; timestamps remain UTC. A verified holiday is skipped. Trading and special sessions are due only at their verified finalization timestamp, not merely the closing time. Missing, future-known, unverified or malformed calendar data leaves an explicit waiting reason. The scheduler never assumes weekdays or falls back to an older favorable calendar.

G02 historical coverage and G03 adjustment readiness must both pass at the cutoff. An active strategy profile and verified intended universe are also required. Other missing member or benchmark data remains explicit in the EOD scan's normal coverage/RS results. Once due, a single immutable request pins the session, calendar and observation cutoff. Preparation runs through an `eod-prepare` job containing only that stored request UUID, followed by the existing `eod-scan` member jobs. No price, READY flag or arbitrary financial payload is accepted by the preparation handler.

Scheduling covers the current IST session. It does not silently backdate missed sessions after a multi-day outage; historical work belongs to the explicit replay/backfill paths. The manual scan preparation command remains available.

## Ownership, retries and diagnostics

The database grants one 30-second scheduling lease per scope, renewed by its owner. A replacement owner increments the persistent fence. Scheduling takes a row lock and checks owner, fence and expiry before publishing a request/status; a stale or expired owner receives `SCHEDULER_LEASE_LOST`. Duplicate polls and process restarts return the original session request and cutoff.

SQL requests reconstruct lost Redis jobs. If Redis says completed but no EOD plan exists, preparation is redelivered with the same identity. Exhausted four-attempt failures retain their state and typed preparation reason. A failed request's cutoff is immutable; it must not be silently replaced with later evidence. Existing gateway ownership remains in worker code, global broker quotas are shared in Redis, and backfill window commits retain their own database lease fencing. Scheduling itself makes no broker requests and places no orders.

`GET /api/v1/system/scheduler` returns the last observation time, state/reason and ten recent scheduled requests. No observation is `SCHEDULER_NOT_OBSERVED`, not a claim of health. Use the returned scan UUID with the [scan progress endpoints](eod-scans.md).

Verification includes holiday/special-session boundaries, delayed finalization, IST midnight, future evidence, readiness waits, duplicate owners, lease expiry/takeover, stale-owner rejection, immutable requests, queue loss and background preparation. Synthetic integration data stays in `vcp_test`.
