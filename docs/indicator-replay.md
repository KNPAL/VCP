# Durable indicator correction replay (KAN-60)

The worker now executes the indicator stage of correction replay. SQL selects pending correction requests with a KNOWN adjustment snapshot containing the corrected raw revision. The queue carries only the event UUID, adjustment snapshot hash and calendar snapshot hash. The handler reloads all financial evidence from PostgreSQL; it does not accept bars or prices from queue messages.

The pinned calendar must cover every date of the adjusted series and its finalized sessions must exactly match the stored bars. Missing/unknown adjustments, mismatched listings, future adjustment snapshots, missing corrected revisions, incomplete calendars and unfinalized bars reject processing. The original seed is replayed conservatively across every prefix because corporate-action adjustments may affect history earlier than the corrected raw bar. EMA/ATR never reuse an old recursive accumulator. Insufficient warmup and missing RS remain explicit UNKNOWN values.

Outputs use a data revision derived from the adjustment and calendar hashes, keyed with listing/session/strategy. They are retrospective correction evidence evaluated at the adjustment snapshot's as-of timestamp, not assertions of what was known historically. Each prefix contains only its own source revisions. Original indicator evidence, actual fills, user decisions and market signals are untouched.

All generated indicator snapshots and an immutable IndicatorReplayReceipt commit in one transaction. A collision with different evidence rolls back the entire batch. Duplicate and concurrent delivery reuse identical evidence. The receipt states INDICATORS_REPLAYED and lists remaining MARKET_SIGNALS/VCP/SCANS stages; it never marks the overall correction request complete.

The dispatcher checks SQL receipts rather than Redis completion. Missing jobs are reconstructed, and completed Redis jobs without a receipt can be recreated. Exhausted jobs retain failure state. Dispatch inspection timestamps rotate selection so failing old work does not hide newer requests. A newly verified adjustment revision gets a separate job identity and receipt. Missing adjustment evidence leaves the original correction request pending.

After normal migration/build, worker startup registers `indicator-replay` automatically. An operator can also run `node apps/worker/dist/submit-indicator-replay.js <input.json>` with the worker Redis environment, supplying exactly `eventId`, `adjustmentId` and `calendarHash`. All three must identify existing stored evidence. This submission performs no broker operation.

Explicit context can drive correction replay for the same listing and interval; automatic discovery can prepare initial or changed-interval context when stored evidence covers it. Dependency checks propagate peer and verified benchmark corrections through the same pipeline. The replay stages do not imply source permissions or trading eligibility. Whole-universe scan materialization remains KAN-73.

## Chronological structure and breakout replay

`replayStructure` evaluates each completed session against the preceding frozen READY snapshot before invoking the VCP detector on the current prefix. Every prefix has its own finalization timestamp; later bars cannot alter earlier output. Adjusted fractional volume uses exact eight-decimal units for RVOL comparisons; the original raw-volume path still rejects fractional shares. All generated events are retrospective evidence and are not inserted into the live MarketEvent or UserSignalDecision tables.

The database service reloads a completed indicator receipt, its adjusted bars/calendar, an instrument snapshot and the exact supported strategy profile. It verifies historical cash-equity mapping and a consistent tick across the replay interval. Unsupported tick changes, missing mappings, unknown profiles and mismatched calendar coverage fail explicitly. Replay decision time includes the receipt/profile/mapping availability times; historical reconstruction does not claim those inputs were available on the original trading date.

Results are stored immutably in StructureReplayResult, separately from original pattern and trading decisions. Concurrent or repeated execution returns identical evidence. The registered `structure-replay` worker accepts `indicatorReceiptId`, `instrumentSnapshotId`, `profileId` and optional `strengthReplayId`. The legacy `node apps/worker/dist/submit-structure-replay.js <input.json>` command accepts only the first three references and therefore produces a partial replay without historical RS.

The pure engine accepts per-session RS evidence and rejects future-known strength as unavailable. Explicit retrospective context can be computed later, but must match the reconstructed session, contain no later bars and be known by the replay decision timestamp. Missing context remains PARTIAL/HISTORICAL_RS_UNAVAILABLE. A complete golden fixture verifies a confirmed breakout against yesterday's pivot even when today's high raises the new pivot.

## Historical relative strength preparation

After applying migration 22 and building the worker, run `node apps/worker/dist/prepare-strength-replay.js <input.json>` with DATABASE_URL configured for the intended database. Use the same protected database environment as the other worker tools; do not paste database credentials into the JSON file. The file contains these existing evidence references:

```json
{
  "indicatorReceiptId": "<64-character receipt hash>",
  "instrumentSnapshotId": "<64-character instrument snapshot hash>",
  "profileId": "<64-character supported profile hash>",
  "universeSnapshotId": "<64-character historical universe hash>",
  "benchmarkAdjustmentId": "<64-character benchmark adjustment hash>",
  "benchmarkProofId": "<64-character G04 proof hash>",
  "memberAdjustmentIds": {"<listing UUID>": "<64-character adjustment hash>"},
  "evaluatedAt": "<UTC timestamp at or before now>"
}
```

The universe must have verified historical constituents and cover the complete replay interval. G04 must pass at evaluatedAt and its details must pin `identifier: NIFTY_500_PRICE` and the same benchmark adjustmentId. Mapping and adjustment evidence must already be available; the target member must use the indicator receipt's exact adjustment revision. Canonical eligible NSE EQ listings take precedence over BSE CASH. Ambiguous or missing members remain in the intended denominator. Benchmark validation and the 80% comparable-member rule fail closed; percentile ties use exact midpoint ranks. Each session is computed from its own prefix, preserving eight-decimal RS precision.

Preparation stores immutable RelativeStrengthReplay evidence and prints its id, state and session count. With the worker running, SQL dispatch automatically queues structure replay using that reference. Lost Redis jobs are recreated; exhausted jobs retain failure state. A result is REPLAYED only with at least 252 sessions and known RS after warmup; otherwise it is PARTIAL. SCANS remains a separate unfinished stage. No broker request or live trading event is created by these commands.

## Automatic correction context reuse (migration 23)

Once an explicit COMPUTED RS context exists, a new indicator receipt for the same listing and exact historical interval can reuse it. SQL selects the most recently created explicit context, pins its universe, mapping, profile, benchmark proof and peer revisions, and replaces only the target adjustment revision. The evaluation timestamp is frozen in an immutable StrengthReplayPlan. Concurrent preparation produces one plan per receipt/template. Automatically generated RS results cannot become templates, preventing recursive plan creation.

The worker's `strength-replay` queue accepts only a planId; it reloads and validates all evidence in PostgreSQL. CPU-intensive RS computation runs in the job handler. SQL-driven dispatch recreates lost jobs, rotates inspected work and preserves exhausted failures. An expired benchmark proof fails validation against the pinned evaluation time; the system does not bypass it or repeatedly create new plans to reset retry limits. Prepare a new explicit context with verified current evidence to recover that case.

A new verified corporate-action adjustment can be selected by the existing indicator dispatcher using the original candle replay request, without a new raw candle event. This recomputes adjusted EMA/ATR from the original seed and creates a new receipt. Context reuse then delivers historical RS and VCP/signal reconstruction separately from the original decisions. The integration fixture verifies a split correction, full-recompute equivalence, concurrent planning, lost-job recovery and unchanged original replay evidence.

An adjusted pivot can fall between current valid price ticks after a split. Retrospective replay records UNKNOWN/ADJUSTED_PIVOT_OFF_TICK for that comparison and continues reconstructing subsequent sessions. It never rounds that pivot into an invented valid breakout. Live raw-price breakout validation remains strict.

Peer and benchmark changes are handled by the dependency scheduler described below. Scan refresh remains separate KAN-73 work.

## Initial context discovery (migration 24)

After reusable explicit context is considered, the worker inspects up to 25 remaining indicator receipts per poll. It selects the latest instrument snapshot and the latest historical NIFTY 500 universe covering the receipt's entire date range, the latest G04 benchmark proof, the supported immutable strategy profile and the latest available adjustment for each member. The target revision remains pinned to its indicator receipt. Unknown member adjustments remain missing in the full intended denominator. Discovery does not fall back to an older favorable mapping or benchmark PASS when the latest evidence is unavailable or failing.

Missing mapping, target mapping, historical universe, benchmark proof or profile records WAITING plus a specific RS_* reason in ReplayContextDiscovery. Inspection timestamps rotate waiting receipts; they are reconsidered when stored evidence changes. No prices, constituents, permissions or readiness evidence are fabricated. The same rules can prepare a different date range only when the selected historical universe and mapping cover it; changing membership inside that range still requires separate interval support.

Available context is frozen in a StrengthReplayPlan with a null templateId. A unique partial index permits one discovered plan per receipt, including concurrent discovery attempts. Existing plans are reused unchanged, so retry identities and evaluation timestamps remain stable. The existing strength-replay handler validates the pinned sources and produces immutable RS evidence before structure replay. Automatic plans never serve as explicit templates.

Discovery does not reset failed plans when source evidence later changes. Existing bounded-retry failures remain inspectable; use the explicit preparation command with valid updated references to recover them.

## Dependency propagation (migration 25)

The worker checks the most recent RS result for each indicator receipt, in batches of 25 with rotating inspection timestamps. For each pinned universe and mapping, it compares the latest peer adjustments against the stored member revisions. A target's own adjustment remains pinned to its indicator receipt; its own correction is handled by a new indicator receipt. Newly available peer revisions can therefore refresh every dependent receipt, including receipts whose target candles did not change.

A benchmark correction requires a current passing G04 proof identifying the newest verified adjustment of the same benchmark listing. A failing/expired proof, unknown peer adjustment, changed benchmark identity or stale proof reference records an explicit RS_DEPENDENCY_* waiting reason in ReplayDependencyCheck. Older favorable proof or adjustment evidence is not substituted. When the required evidence arrives, a later inspection can prepare the dependency plan.

Changed dependencies produce an immutable StrengthReplayPlan with sourceReplayId and a unique dependencyKey derived from pinned references, excluding the inspection timestamp. Concurrent and repeated checks cannot create repeated jobs for the same dependency set. Bounded failed jobs retain their state. After computation, the new RS result becomes the next comparison baseline, preventing recursive replays with unchanged dependencies. The standard structure dispatcher then reconstructs affected VCP and signal evidence into new immutable results; original decisions, live MarketEvent records and fills remain unchanged.

Historical intervals still require verified membership and mapping coverage across the whole interval. Unsupported changing membership/ticks and missing source evidence fail closed. This is correction reconstruction, not live trade execution or scanner completion.

Verification covers a historical correction against full EMA/ATR recomputation, prefix lineage, warmup UNKNOWN, unchanged original snapshots, concurrent/duplicate processing, invalid source references, immutable receipts, transaction rollback, queue reconstruction and bounded failed-job handling. Fixtures are synthetic and restricted to vcp_test.
