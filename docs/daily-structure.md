# Daily structure and frozen breakout evaluation

KAN-80 now has an internal durable coordinator, `processDailyStructure` exported by `@vcp/database`. Apply migration 27 with `node scripts/database-command.mjs migrate` after building workspace dependencies. Existing startup commands are unchanged.

The coordinator serializes execution per listing. It loads the immediately preceding session's immutable `DailyStructureExecution`, evaluates the current finalized candle against that stored primary, inserts any market event, and only then invokes today's detector. The event, resulting patterns and complete execution evidence commit in one transaction. A detector or storage failure rolls all writes back. Concurrent duplicate calls return the same result; changing a completed session's input raises `DAILY_SESSION_ALREADY_FROZEN`. Corrections belong to the separate retrospective replay pipeline and cannot replace live decisions.

Inputs include the finalized adjusted series and source revisions, tick, adjustment snapshot revision, price-basis revision, immutable configuration hash, decision timestamp and optional verified relative-strength evidence. Evidence and configuration are stored with the execution. `scaleRevision` identifies a stable corporate-action price basis; it must not be the daily candle snapshot hash, which changes every session. A changed basis blocks breakout comparison with `PREVIOUS_PRICE_BASIS_CHANGED` until upstream processing can provide a valid comparison. The coordinator never guesses a split conversion.

Missing yesterday's primary, mismatched sessions/listings, changed configuration, late reconstruction of yesterday's state, off-tick adjusted pivots and missing finalization cannot confirm a breakout. Missing or future-known RS is recorded as unknown and cannot produce READY. Market breakouts remain independent of entry permission; this coordinator creates no order, fill, position or user eligibility decision.

## Remaining integration

The [EOD scanner](eod-scans.md) now selects verified calendar sessions, canonical listings, pinned adjusted candles and point-in-time RS evidence from storage. It derives the price basis from effective corporate actions, checkpoints intended members, delivers jobs through BullMQ and materializes the completed scan. `GET /api/v1/system/daily-structure/{id}` exposes immutable daily evidence to authenticated callers. Optional [calendar-driven preparation](scheduler.md) is available with migration 29. Calling the internal coordinator with arbitrary client-provided financial payloads is not supported.

## Verification

`tests/daily-structure.test.mjs` exercises frozen pivots when today's high changes the detector, missing/late/changed context, RS availability, fractional adjusted volume and finalization. `tests/database.integration.mjs` exercises consecutive stored sessions, duplicate concurrent delivery, a detector failure after event insertion with full rollback, immutable execution records and rejection of changed same-session inputs. Tests use synthetic fixtures exclusively in `vcp_test`.
