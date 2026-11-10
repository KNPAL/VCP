# Workspace usability review — 8 November 2026

## Findings and changes

- Users landed on a dashboard before any market data existed. Login and the root now open Start here, with separate broker, stock setup, download and research steps based on current API responses.
- Stock downloads and job progress were buried inside Universe & Data. Both now have direct navigation entries near the top.
- A connected broker with missing data permissions was told to reconnect. Connected sessions now point to market-data setup; expired sessions still offer reconnect.
- Empty stock choices looked like selectable NIFTY 500 data. The download form is withheld when there are no eligible stocks, with the actual missing prerequisites displayed instead.
- Chart inspector showed an empty execution selector and UNKNOWN. The selector appears only when choices exist, with an explanation and setup/download links otherwise.
- Backtests offered empty comparison controls. Comparisons now require stored runs; the empty state explains the required history/replay and that this page only displays completed results.
- Screener and watchlists now distinguish missing scans/lists from valid zero results and link to setup.
- Start here and the existing responsive layout support mobile; runtime errors remain visible with retry instead of being presented as empty data.

## Remaining functional limitations

Updated 10 November 2026: Data setup & downloads now initializes official stock reference data and a supported daily calendar under the owner-declared personal-use setting. VCP has 495 eligible stock mappings; unsupported source entries are listed explicitly. Calendar coverage is currently 1 January 2025 through 10 November 2026. Older session history needs further review. Scan/replay creation still uses operator workflows. See [market-data setup](market-data-setup.md).

The broker authentication implementation and stored credentials are preserved. No brokerage orders or synthetic production stock records were created.

## Validation

Production web build and repository lint passed. All 13 browser checks passed, including first-login navigation, mobile layout, populated chart/backtest views, broker reconnect/expiry, historical downloads and empty installations. Restarted the local app and verified Start here plus the download setup state against the real VCP database. That earlier empty-installation audit is superseded by the 10 November validation: 495 selectable stocks and a completed live download storing seven RELIANCE candles. The new setup/download browser checks and integration results are documented in the market-data setup guide.
