# Historical daily exits (KAN-114)

The daily exit model adjusts position quantity, entry price and stops for known, verified split/bonus actions before comparing raw OHLC prices. Fractional share entitlements remain unresolved rather than inventing cash-in-lieu. It reuses live `protectiveDecision` and `partialProfit` with explicitly synthetic observations; those observations never enter Redis or the live quote pipeline.

The conservative order is protective overnight gaps, protective stop touches, prior EOD scheduled sells, then partial 2R profit. A bar touching both stop and target exits the full quantity at the modeled stop first and records the ambiguity. Gaps use open times one minus slippage; other stops use stop times one minus slippage. Prior EOD sells use the open. A target-only partial uses one-third rounded down to market lots, and is suppressed once already taken. Prices round down to ticks; sell fees round up with the pinned minimum fee.

Protective and prior-EOD outcomes are labeled `BEFORE_ENTRIES`; partial-profit outcomes are `AFTER_ENTRIES`. Each fill exposes `cashAvailableAt`: intraday stop/target proceeds are modeled at the close and cannot fund an opening entry. The FIFO cash-ledger coordinator, subsequent trailing and cooldown integration are KAN-115 work. OHLC cannot reveal exact intraday ordering or execution time; the result includes the full session interval and `guaranteed: false`.

Unknown liquidity, price-limit locks, non-trading sessions, unfinalized bars, future data, unknown actions or stops not effective at the opening return `UNABLE_TO_SIMULATE` with no fill. Every result remains synthetic, non-executable and ineligible for verified-performance claims.

Migration 48 persists immutable daily decisions per owned run/position/session, with timestamps and source revisions. It binds raw prices, calendar, costs, current mapping and action history to the archived snapshot, rejects superseded visible bar revisions, retains research limitations and prevents changed retries from replacing an earlier decision. Declared synthetic position inputs are retained as assumptions; actual manual portfolios are untouched.

After configuring the [operator environment](historical-snapshots.md), supply JSON matching `HistoricalExitInput` in `packages/backtest/src/daily-exit.ts`:

```powershell
node scripts/historical-snapshot.mjs exit <run-id> C:\archives\daily-exit.json
```

Focused tests: `tests/backtest-exit.test.mjs`. Database binding, duplicate/retry and owner-isolation checks: `tests/backtest-snapshot.integration.mjs`.
