# VCP screener

Open `/screener` after signing in. The page selects the latest stored scan once. Next/previous pages and state changes retain its immutable scan ID; **Refresh to latest scan** explicitly selects a newer scan. Filtering never renumbers server ranks. A failed fetch hides the previous results until retry succeeds.

Rows display stored RS percentile, contraction high/low/depth, final depth, VDU, ATR, full-base pivot, absolute price distance and rejection/readiness reasons. Null values remain UNKNOWN. No browser detector, ranking calculation or broker order call exists. Symbols are optional current canonical mapping labels; listing UUIDs remain visible. Coverage always describes the full scan, including failed/missing and excluded members, even on an empty filtered page.

The screen shows the scan's IST timestamp, its raw age in seconds, data revision and configuration hash. A scan older than 24 hours gets a STALE display warning; this is not an exchange-calendar or BUY-readiness decision. Quote freshness remains UNKNOWN because an EOD scan is not a live quote. Loading, no stored scan, no matching candidates, partial/error coverage, forbidden access and unavailable service are distinct states.

Choose a research watchlist to save a canonical listing. Save the current market-state filter under a list name and restore it with **Apply saved state filter**. Saving an existing list name replaces its filters. A saved state filter does not restrict results to watchlist members. Watchlist writes use the authenticated CSRF token and existing immutable audit records; scan evidence is never changed. Current canonical mapping is required to add an instrument.

## API

- `GET /api/v1/vcp/latest-scan`: authenticated latest identity and coverage, or `UNKNOWN / NO_COMPLETED_SCAN`.
- `GET /api/v1/vcp/candidates?scanId=<uuid>&state=WATCH&limit=25&sort=rank`: immutable ranked page, next cursor, coverage and source metadata. Use that same scan ID and state with the returned cursor.
- Existing watchlist APIs accept an optional validated `filters.state`, including the empty string for all states. Existing query/exchange-only filters remain compatible.

## Verification

Run the database integration checks with `node scripts/database-command.mjs test database`; fixtures are restricted to `vcp_test`. `pnpm test` covers stable rank/cursor behavior and rejection of cursors from other scans or filters.

`tests/screener.browser.mjs` runs headless browser interactions against an already running local app. It authenticates with the configured test user (or local owner secret file), intercepts financial responses only inside that browser, and does not insert financial data into the application database. It verifies pagination identity, filter reset/restore, CSRF save actions, 403/503, loading/empty/UNKNOWN/stale states, mobile overflow and keyboard focus. Screenshots are written under ignored `.runtime/`.

Provide Playwright through the `playwright` package or set `VCP_PLAYWRIGHT_MODULE` to its installed `index.mjs` file URL. Use its installed Chromium, or set `VCP_BROWSER_CHANNEL=msedge` for installed Edge. Set `WEB_TEST_BASE_URL` if not using `http://localhost:3002`, then run `node --test tests/screener.browser.mjs`. Override credentials with `WEB_TEST_LOGIN` and `WEB_TEST_PASSWORD` when using an isolated test app. This optional browser suite is separate from the default unit suite.
