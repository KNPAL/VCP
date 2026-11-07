# KAN-134 performance acceptance

## Scope

Measurements use the local benchmark deployment: Node 24.15.0, Windows x64, Intel Core i5-8250U (8 logical CPUs), 8 GiB host RAM, Docker PostgreSQL 17 and Redis. All market data and grants are explicitly synthetic and isolated in disposable schemas of `vcp_test`. No broker authentication, order request or production-data import is involved.

| Requirement | Target | Recorded result |
| --- | --- | --- |
| Local compute, 500 stocks | <=120 seconds | 72.921 seconds (2026-11-06) |
| Finalized-data EOD, 500 stocks | <=30 minutes | 389.030 seconds / 6m 29s (2026-11-07) |
| Cached authenticated screener, first 50 rows | P95 <=2 seconds | 740 ms (2026-11-07) |
| Healthy normalized tick to persisted protective event | P95 <=5 seconds | 5,000 ms rounded; unrounded comparison passed (2026-11-07) |

## Method

`node scripts/benchmark-scan-compute.mjs` measures relative strength, market regime, indicators, daily structure/breakout and candidate ranking across 500 stocks with 310 sessions. Fixture creation and prior-day frozen-state preparation are excluded.

`node scripts/database-command.mjs benchmark eod` creates 500 equity histories and one independent benchmark history, registers reference permissions, and invokes production scan preparation/item processing to persist all 500 outcomes. EOD timing starts after fixture data is available and includes plan preparation. The script requires a COMPLETE scan with 500 analyzed instruments. It then makes 21 authenticated HTTP screener requests with `limit=50`: one warm-up excluded and 20 measured responses. Each response must contain 50 rows. P95 uses the nearest-rank sample.

`node scripts/database-command.mjs benchmark risk` publishes normalized synthetic ticks through the real Redis cache and runs the production held-position monitor at five-second cadence. It measures 20 varied tick-arrival phases through observation of the committed protective event in PostgreSQL. The fixture has one held position. Broker transport, notification delivery, unrelated worker dispatch jobs and larger portfolios are outside this measurement. This is benchmark acceptance for this configured workload, not an unconditional production latency guarantee.

Run workloads sequentially without simultaneous builds/integration suites. Each database workload removes only its own isolated schema after completion. Database credentials are read by the existing helper without printing them.

## Correctness and limitations

The functional suites separately cover missing/denied data, UNKNOWN states, immutable scan coverage, stale/disconnected quotes and preserved actual holdings. Performance numbers do not activate G04/G07 or authorize market-data use. Production licensing, deployment/rollback and launch checks remain their own Jira gates.


## Recorded validation

All four thresholds passed on the configured benchmark workload. The latency result is at the displayed threshold and provides little performance margin; it is not evidence for larger portfolios or contention from unrelated jobs. The original 2026-11-06 latency sample was 4,856 ms; the latest 2026-11-07 result above takes precedence.

Local logs (ignored by Git):

- `.runtime/kan134-compute-optimized.log`: 500 stocks / 310 sessions, 72,921 ms, passing.
- `.runtime/kan134-eod-20261107.log`: completed 2026-11-07 09:39 IST; 500 analyzed stocks, EOD 389,030 ms, API P95 740 ms, passing.
- `.runtime/kan134-risk-20261107-retry.log`: completed 2026-11-07 15:05 IST; 20 samples, P95 rounded to 5,000 ms, passing against the unrounded duration.
- `.runtime/kan134-boundaries-20261107.log`: 10/10 tests passed covering scan completeness/paging, quote freshness and ownership, protective-gap behavior, episode lifecycle, and missing/invalid benchmark readiness. Command: `node --test tests/scans.test.mjs tests/live-quotes.test.mjs tests/protective-stops.test.mjs tests/readiness.test.mjs`.

The first latency attempt could not connect because the local database had stopped after the successful EOD run. PostgreSQL/Redis were restarted and the complete latency run then passed. No failed or interrupted run was counted as a passing measurement. No application deployment or remote push was performed. Hosted CI remains separate work for KAN-4/KAN-45; it is not claimed by these local performance results.
