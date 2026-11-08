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

These UI changes do not populate VCP with invented market data. The independent PostgreSQL database still needs reviewed instrument mappings, NIFTY 500 membership, calendar/final-session evidence and source authorization. There is no completed one-click market-data initializer in this version. This is an application capability gap, not something solved by reconnecting the broker. Scan/replay creation also still uses operator workflows; result pages now disclose this limitation.

The broker authentication implementation and stored credentials are preserved. No brokerage orders or synthetic production stock records were created.

## Validation

Production web build and repository lint passed. All 13 browser checks passed, including first-login navigation, mobile layout, populated chart/backtest views, broker reconnect/expiry, historical downloads and empty installations. Restarted the local app and verified Start here plus the download setup state against the real VCP database. The database still reports zero selectable stocks; no real market-data download was claimed or fabricated.
