# End-of-day scans

The scanner prepares an immutable plan from stored evidence and dispatches each intended member through the existing BullMQ worker. It never accepts supplied prices or READY states in a queue payload and never places orders.

## Setup and execution

Build the API and worker dependencies, apply migrations through 28, and run the normal API/web/worker processes described in the root README. The source data must already include:

- A verified NIFTY 500 universe and canonical cash-equity instrument mapping, known at the scan cutoff.
- A verified calendar snapshot covering the required historical window and the finalized target session.
- A registered and activated supported strategy profile.
- Stored raw candle revisions and verified adjustment snapshots scaled to the target session.
- A passing G04 proof referencing the verified NIFTY 500 price benchmark adjustment. Missing benchmark evidence produces unknown RS, not invented rankings.

Prepare today's finalized session using the stored calendar SHA256:

```powershell
node scripts/database-command.mjs scan YYYY-MM-DD CALENDAR_SHA256
```

The command prints the scan UUID, intended count and data revision. Supply that UUID as the final argument to inspect/resume the same request without changing its cutoff. It uses the application database credentials internally without printing them. The normal worker polls stored plans every five seconds and delivers up to 25 pending item IDs per poll. Migration 29 adds optional [calendar-driven preparation](scheduler.md); both preparation modes require the target session to match the cutoff's IST date. Historical correction replay remains separate.

## Persistence and recovery

Plans pin the universe, mapping, calendar, profile, benchmark proof, adjustment IDs and RS calculation revision. Missing mappings and unusable latest adjustments get explicit reasons. Newer evidence cannot replace an already prepared plan. The RS coverage denominator includes all intended members; insufficient comparable coverage leaves RS unknown.

New plans also persist `regime` evidence: the finalized session and cutoff, benchmark close/SMA50/SMA200 and source proof, each intended member's adjusted close/SMA50 and adjustment revision, and the resulting score, breadth, multiplier and regime. Missing members remain in the denominator; below 80% usable coverage or missing benchmark inputs produces UNKNOWN. A newer failed benchmark proof prevents new plans from reusing an older passing proof. Retries preserve the original evidence. The authenticated scan-job progress response exposes this historical evidence; older plans return `regime: null`. This does not yet authorize current BUY plans: entry-plan sizing now checks calendar freshness, latest benchmark readiness, universe/mapping/profile identity, and superseded adjustment/raw revisions. Any calendar revision requires a new EOD plan; the reader never falls back to an older passing plan.

Each valid member runs the daily coordinator, which evaluates the previous frozen primary before today's detector. Indicator evidence, candidate evidence and a member checkpoint are stored. Candidates include RS and raw turnover availability reasons; they do not imply user BUY permission. Unmapped members use `isin:<ISIN>` as a missing-outcome key, never a fabricated listing UUID. The final immutable scan preserves all intended outcomes and reports COMPLETE, PARTIAL or ERROR according to missing coverage.

Queue loss is repaired from SQL. A completed Redis job with missing durable completion is redelivered with the same identity. Four exhausted attempts remain failed for inspection rather than being restarted indefinitely. If a process stops after the last checkpoint but before final scan materialization, a subsequent delivery materializes the scan without recomputing completed members. Changing an already frozen daily session's inputs records `DAILY_SESSION_ALREADY_FROZEN_REPLAY_REQUIRED` as a missing outcome, allowing the new scan to finish explicitly PARTIAL or ERROR. Use the correction replay workflow rather than replacing live evidence.

Authenticated read endpoints:

- `GET /api/v1/system/scan-jobs/{scanUuid}`: pinned request, checkpoints, dispatch failures and final result.
- `GET /api/v1/system/scans/{scanUuid}`: completed immutable scan and ranked candidates.
- `GET /api/v1/system/daily-structure/{executionSha256}`: full frozen breakout and detector audit evidence; analyzed outcomes expose `dailyExecutionId`.

No credentials or synthetic data are required to exercise the tests. `node scripts/database-command.mjs test` runs against `vcp_test`, including queue loss, immutable revisions, missing coverage, complete RS coverage and repeated delivery. Production source access and verification remain deployment prerequisites.

