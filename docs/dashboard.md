# Dashboard

KAN-118 connects `/dashboard` to authenticated `GET /api/v1/portfolio/dashboard`.

The server composes persisted scan counts, the latest EOD job's intended and processed coverage, production regime validation, the owner's actual journal and valuation, position-status evidence, and G01–G10 readiness. Each source keeps its own timestamp; the response is not a simultaneous market snapshot. The page links the underlying evidence and shows IST times and raw ages. Counts in WATCH/READY/BUY belong to the named completed scan, not the newer unfinished job, and do not establish personal BUY eligibility.

Financial values expire at the server's risk deadline. Current SELL counts exclude expired observations and closed holdings; degraded or missing monitoring is explicit. Older alerts remain available in the history endpoint. A scan over 24 hours old receives a display-age warning, distinct from the server's calendar-aware regime checks. Expired readiness proofs cannot continue to display PASS. The page makes no orders or financial writes.

Refresh reloads evidence and hides previous values during loading or failure. Empty, UNKNOWN, stale, 401, 403 and 503 states are explicit. Native buttons and evidence links support keyboard access; cards stack on mobile.

Verification:

```sh
node scripts/database-command.mjs test dashboard
```

The isolated browser runner supports `VCP_DASHBOARD_TEST=true`, `WEB_TEST_PORT=3002`, `VCP_BROWSER_CHANNEL=msedge`, and `VCP_PLAYWRIGHT_MODULE` pointing to an installed Playwright module. Run `node scripts/database-command.mjs test-web` after building API and web; ports 3001 and 3002 must be free. Browser financial fixtures are intercepted responses only and are never inserted into the application database.
