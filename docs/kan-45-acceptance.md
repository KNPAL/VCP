# KAN-45 acceptance record

Scope: validate the independently identified NIFTY 500 **price** index, with at least 252 completed, aligned sessions, verified adjustments and chronological source evidence. Jira explicitly requires fixture-based acceptance. Production G04 activation is a separate operation requiring actual authorized source evidence; synthetic fixtures never activate the application database.

## Implemented behavior

- Independent review binds the index identifier, listing UUID and digest of all session closes to a permitted BENCHMARK source. The reference publisher must differ from the contributing raw-candle provider.
- Calendar, adjustment, raw revision, finalization and knowledge timestamps must align. Missing, insufficient, mismatched, future-dated or denied evidence cannot create a passing proof.
- Readiness revalidates the stored proof and current source permissions. Failed benchmark evidence leaves market regime UNKNOWN and blocks BUY readiness; research scans retain intended-universe coverage and explicit missing-data states.
- Prices use exact decimal handling; evidence and scan plans remain immutable. No broker order endpoint is involved.

## Verification commands

After building the workspace and starting local PostgreSQL/Redis:

```sh
node --test tests/readiness.test.mjs
node scripts/database-command.mjs test eod-scan rs-replay entry-acceptance
```

The readiness suite covers the exact 252-session boundary, insufficient history, malformed dates/prices, missing identity and unaligned evidence. EOD integration covers persisted proof rejection, wrong index/listing/digest, same-publisher reviews, future-dated reviews, denied source permissions, UNKNOWN regime and research continuation. Relative-strength replay checks pinned benchmark evidence and corrections. Entry acceptance exercises persisted BUY-blocking behavior.

## Closure gates

- Local verification on 2026-11-06: all 5 readiness tests and all 3 EOD/relative-strength/entry integration tests passed. The integration run completed in 155.5 seconds using isolated test schemas. ESLint passed for the changed EOD test; `git diff --check` passed. Logs: `.runtime/kan45-readiness-final.log` and `.runtime/kan45-acceptance-final.log` (local, ignored).
- Attach a passing hosted CI run for the corresponding changes. The user owns this step and has requested that changes remain local.
- Keep actual G04 UNKNOWN until the licensed independent reference and required source evidence are supplied. A Coded implementation does not grant data permissions or activate live trading readiness.

Execution order requested on 2026-11-06: KAN-45, then KAN-44, then KAN-134. Do not move To Do tickets into In Progress during this closeout sequence.
