# Optional research comparator (KAN-138)

Run from the repository root after building the workspace:

```text
node scripts/proxy-research.mjs <reviewed-series.json> <as-of-UTC>
```

The local input contains `source` (the existing [SourceRecord permission/freshness contract](registry-readiness.md)) and `series` (a production `VcpSeries`: adjusted OHLC/volume, explicit expected exchange sessions, finalized/ended UTC timestamps and revision identities). Use only a reviewed, permitted export with independently verified exchange-session coverage and corporate-action adjustments. The command does not download external data, store source data, alter readiness gates, change the portfolio or contact a broker. A caller-provided verification flag does not itself establish licensing or calendar accuracy.

DISPLAY and DERIVE must both pass the source registry checks at the requested cutoff. The source must cover the supplied series; denied, stale, expired, future or missing evidence returns UNKNOWN and hides calculated values. The production validator rejects raw-scale, unadjusted, incomplete, unordered and not-yet-finalized bars. The output includes an input-file SHA-256 for reproducing the same observation.

`TRENDSPIDER_STYLE_100D_BREAKOUT` requires at least 101 completed sessions. The final close must be strictly greater than the highest high of the **previous 100** sessions, and final volume must be strictly greater than the mean volume of the **previous 20** sessions. The current bar is excluded from both baselines. A zero volume baseline is UNKNOWN. Exact integer arithmetic determines the boundary; the displayed RVOL is rounded down to six decimals and does not drive eligibility.

A match is labeled `MOMENTUM_PROXY_BREAKOUT`. Every result retains `BUY_BLOCKED`, `buyEligible: false`, `executable: false` and `structuralVcp: false`. This observation never enters the main structural VCP candidate/risk/execution pipeline. Historical observations do not claim current executable prices or guaranteed fills.

The broader `TRENDSPIDER_STYLE_VCP_PROXY` remains UNKNOWN with `PROXY_THRESHOLDS_UNCONFIGURED`. Jira names market cap, SMA20, relative performance, 100-day/weekly proximity, rolling higher lows and 20-day volume decline, but supplies no complete thresholds/lookbacks. The user approved implementing the exact 100-day rule while keeping unspecified proxy rules UNKNOWN. No guessed thresholds or fabricated market-cap/weekly data are substituted.

Validation: strict equality and fractional-volume boundaries, 100/101-bar warmup, zero baseline, missing/denied/future/expired source, raw/unadjusted/incomplete series and CLI source gates. Tests use synthetic local fixtures only.
