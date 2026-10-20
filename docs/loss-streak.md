# Three-loss cooldown

KAN-103 evaluates actual journal positions independently of proposals and alerts. An episode starts with the first BUY, stays open through partial sells and top-ups, and closes only when actual quantity reaches zero. Reopening the same ISIN starts a new episode.

The net result includes all BUY/SELL prices and fees plus explicitly attributed fees, dividends and corporate-action cash. Three consecutive fully closed losses block new BUY plans and top-ups. A zero or positive completed result resets the counter before a cooldown has begun. Once triggered, subsequent closures during the cooldown cannot cancel it.

The cooldown runs through the next full verified exchange session after the trigger date. Holidays are skipped only when explicitly present in verified calendar evidence; special trading sessions count. The next session must be finalized before the counter resets. Entry-session checks separately prevent trading outside the following eligible market session. Missing or incomplete calendar evidence keeps the cooldown blocked. Late-recorded fills start the cooldown from their recognition time, avoiding an already-expired retrospective restriction.

## Use in My positions

After migration 37, rebuild and restart API, worker and web using the root README. The **Loss-streak protection** panel shows the current counter, cooldown, position episodes, net results and missing-input reasons.

If fees or corporate-action cash are unallocated, the gate is UNKNOWN. In **Attribute position cash**, select the recorded cash event and its actual position episode, provide a reason and confirm the supporting account records. The episode must exist in your journal and precede the cash event. Saving does not change cash balances, quantities or fills.

A later corrected allocation creates a new immutable version. The panel retains recent allocation audit history; earlier versions remain in the database. Partial exits do not increment the counter, and an alert never closes a position.

## API and evidence

- `GET /api/v1/portfolio/loss-streak` returns actual (`REAL`) episode results, the counter, cooldown, reasons, journal hash, allocation revision and recent allocation history.
- `POST /api/v1/portfolio/cash-allocations` accepts `cashEventId`, `episodeId` and `reason`, with session authentication, CSRF and `Idempotency-Key`.
- Identical retries return the original allocation. Changed retry payloads return 409; invalid events or cross-owner references are rejected.

Owner locks serialize allocations, actual journal changes and risk/entry-plan evaluation. Allocation changes invalidate earlier plan evidence. The worker persists loss-streak results in immutable portfolio risk snapshots; entry-plan records also retain the evaluated result. Historic decisions remain intact after fill corrections or allocation corrections.

Public APIs always use the owner's real journal and reject a paper-source override. Pure calculations support a separate paper journal for future simulation work; no paper events are inserted into the actual journal.

Loss-streak PASS is only one gate. Durable regime, broker/readiness and new-candidate quote integration remain unfinished, so overall entry plans remain blocked. Protective SELL monitoring continues independently.

## Verification

```powershell
node scripts/database-command.mjs test database loss-streak entry-risk
pnpm test
pnpm lint
```

Tests cover partial exits, top-ups, fees, corporate credits, corrections, late knowledge, holiday/session boundaries, duplicate evaluations, cash-allocation versions, concurrent retries, owner isolation, immutable decisions and unchanged journal facts. Database fixtures run only in `vcp_test`; browser fixtures intercept responses without creating application financial records.
