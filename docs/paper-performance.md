# Historical paper performance

After building the workspace and running paper sessions, request an as-of report from the repository root:

```text
node scripts/historical-snapshot.mjs paper-report <run-id> <as-of-UTC>
node scripts/historical-snapshot.mjs paper-report <run-id> <as-of-UTC> <manual-comparison.json>
```

Use the same `DATABASE_URL` and existing `VCP_REPLAY_OWNER_ID` configuration as the [paper session workflow](paper-ledger.md). The report is read-only and requires migrations through 52. Its ID is a deterministic content hash. It includes the archive, strategy, data and ledger revisions used to compute it. It does not read live quotes or modify actual fills.

Closed trades are complete position episodes, including any partial sales. Win rate divides profitable episodes by all closed episodes, including zero-P&L episodes. Net realized P&L includes realized partial-sale P&L; net closed P&L includes only fully closed episodes. Costs already recorded in fills remain included. Profit factor divides the sum of positive closed P&L by the absolute sum of negative closed P&L. It is null when there are no losing trades.

Initial R is the first paper entry's executed quantity multiplied by its executed entry price minus its initial structural stop. R expectancy averages closed episodes' net P&L divided by that original risk. Corporate actions and trailing changes do not reset initial R. Missing or late initial-risk evidence produces null expectancy rather than a zero. Regime segments use the entry's recorded regime, and each curve point separately shows that day's available regime evidence.

The daily curve marks remaining shares with pinned final closes available at the valuation cutoff. Equity is cash plus remaining holdings. Compounded return is equity divided by initial capital minus one; returns are fractions, so 0.05 means 5%. Drawdown is the decline from the previous highest equity, starting with initial capital. Missing prices preserve unknown equity/exposure, and an incomplete curve has null maximum drawdown. `observedDrawdown` is only the lower bound seen in available points. A return spanning a missing valuation day is not labeled as a known daily return.

Signals and blocked/missed entry decisions are counted only when known at the report cutoff. The paper execution gap counts signals without a simulated fill. The manual execution gap remains null with `MANUAL_EXECUTION_NOT_LINKED` until a separately evidenced comparison exists; paper fills are not manual trades. A missing fee schedule produces `COSTS_UNCONFIGURED`. Reports retain survivorship bias, source gaps and other limitations and always set performance verification to false.

The as-of reader selects a ledger revision whose events and share adjustments were known by the cutoff. Later closes and corrections cannot silently change an earlier report. Reports remain research outputs subject to the pinned opening, liquidity and fee assumptions described in the session guide.

An optional manual comparison file contains `matchedSignalIds` (unique signal IDs with independently evidenced manual executions), `asOf` and `sourceReference`. Its evidence must be known by the report cutoff. The report preserves that comparison and includes it in its content hash. Supplying a comparison does not import fills, authenticate broker executions or change paper performance; it only computes the separately labeled signal/manual execution gap.
