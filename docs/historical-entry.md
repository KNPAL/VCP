# Historical opening entries (KAN-113)

`simulateOpeningEntry` accepts explicit simulated state at the first session opening following a frozen market signal. Opening evidence must be known at that opening; the function rejects close-day, second-session, future-source and stale-portfolio attempts. It never reads a later daily high, low or close to invent the opening price.

The entry price is open times one plus the pinned slippage, rounded upward to the instrument tick. Use `slippageBps: "10"` for the v4 baseline 0.001 slippage. Alternative cost assumptions are explicit in the immutable snapshot and every result. Buy fees are rounded upward and subject to the configured minimum. A bounded binary search solves quantity with fee-adjusted equity using production `sizeEntry`; production `evaluateEntry`, `structuralStop` and `entrySizingGates` apply the 3% chase, 8% stop, five-position limit, cash, loss-streak, stock, sector, open-risk and gross-exposure limits. Unknown gates block entry. Existing positions cannot receive an automatic add.

Outcomes are `SIMULATED_FILL`, `MISSED` (chase gap) or `BUY_BLOCKED`. Blocked attempts have zero quantity and no fill fees. Every outcome stores the exact assumptions and reasons. Synthetic fills never enter the actual portfolio journal or send a broker order. Portfolio-wide chronological execution and subsequent exits remain separate work.

Migration 47 binds each immutable decision to an owned replay event. The supplied signal, cost configuration, first eligible opening, mapping, market lot, tick and calendar must match pinned historical evidence. A retry returns the same decision; changed input for the same run/signal raises a conflict. Source, occurrence, decision and effective timestamps are simulated; `recordedAt` is the actual database persistence timestamp. Research bias and historical coverage limitations are retained.

Use the [snapshot/replay operator environment](historical-snapshots.md), then supply JSON matching `HistoricalEntryInput` in `packages/backtest/src/entry-fill.ts`:

```powershell
node scripts/historical-snapshot.mjs entry <run-id> <replay-event-id> C:\archives\opening-attempt.json
```

The opening quote and portfolio/market gates are declared historical simulation assumptions, not claims of live readiness. Missing verifiable historical evidence cannot support a verified performance claim. All results remain `executable: false` and `performanceVerified: false`.

Validation covers exact tick/cost arithmetic, fee-aware cash and risk caps, gaps, wide stops, unknown gates, insufficient cash, a sixth position, no automatic add, future inputs, immutable retry persistence, source/cost binding, owner isolation and an unchanged actual portfolio journal.
