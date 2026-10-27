# Universe and data health (KAN-125, Coded)

After signing in, open `/universe`. The screen reads persisted universe membership, instrument mappings, completed scan evidence and current scan progress independently. Counts from different revisions are labelled separately. Coverage comes from the existing verified-calendar coverage service; missing evidence is UNKNOWN, never zero or complete. Latest finalized candles exclude records whose finalization or receipt is in the future.

The screen includes supported/unsupported segments, provider selection, candle gaps, source gates G01–G10, expired proof warnings, and the first 50 sync-window checkpoints with retry reasons. Refresh runs every 15 seconds after the previous request finishes. Manual refresh also reloads coverage even if the health snapshot timestamp is unchanged. Saved research groups remain available through `/watchlists`.

Authenticated read-only endpoints:

- `GET /api/v1/data/health`
- `GET /api/v1/broker/angel-one/status`
- `GET /api/v1/system/coverage/{listingId}?provider={provider}`

Saved owner broker configuration takes precedence over the legacy VCP_BROKER_ACCOUNT_KEY selector. Configure the connection from Settings > Broker Connections. The status API reads local encrypted session evidence and verified static-IP proof; it makes no provider authentication request. It returns no credential envelopes, tokens, session revisions or account keys. The shared health context expires capabilities locally and refreshes after connection changes; stored-data reads remain independent.

## Completed acceptance

Broker configuration/login and shared reconnect health are Coded under KAN-140–143. KAN-125 watchlist/data-health acceptance passed, including saved filters, duplicate additions, error recovery, keyboard controls and mobile layout. Universe & Data now polls the latest manual run and shows its state, requested range, candle counts, latest market date and status reason; download navigation is enabled only with fresh broker readiness. The dedicated download preview and job list/detail pages now implement opt-in submission, polling, cancellation and explicit retry; see [manual downloads](manual-downloads.md). Existing sync windows remain labelled separately from aggregated manual jobs. Exhausted attempts are retained when explicit retry creates a new generation.

KAN-144 is Coded. The read-only preview reuses verified calendar/candle validation, missing-only windows and last-three-session reconciliation, bounded to five years and 400-day windows. Final-session evidence is selected from observed finalized candles or a stored PASSED historical probe matching account, listing and mapping. Missing proof or calendar remains blocked. Probe evidence does not fabricate or import candles. Provider evidence is included in the signed preview's data revision, and changed mappings cannot reuse it. The UI defaults to a five-year range when an end date is first selected, including leap-day handling. The planner reports a 450-session history target. KAN-145 submission and job lifecycle APIs are also Coded; see [manual downloads](manual-downloads.md).

No new migration is required. These changes are currently in the workspace; the deployed local image still contains the previous KAN-127 release.

## Verification

Database/API/web builds and lint passed. Two isolated `vcp_test` database tests cover unknown coverage, unsupported segments, immutable scan evidence, future snapshot/candle exclusion, account-specific broker circuits, expiry and credential non-disclosure. The browser suite covers refresh, source revisions, broker failure, expired proof, UNKNOWN, loading, empty, 403/503 recovery, keyboard controls and mobile overflow. Authenticated API checks also verify both new endpoints reject anonymous access. All fixtures are synthetic and isolated from `vcp`.

Run database checks with `node scripts/database-command.mjs test data-health`. For browser checks, build the web app, set `WEB_TEST_PORT=3002`, `VCP_DATA_HEALTH_TEST=true`, and configure `VCP_PLAYWRIGHT_MODULE`/`VCP_BROWSER_CHANNEL` for the installed Playwright browser, then run `node scripts/database-command.mjs test-web`. The browser harness needs API port 3001 free; never use port 3000 when another app owns it.

Preview verification: `node scripts/database-command.mjs test download-preview` checks persisted gaps/revisions, permissions, five-minute expiry metadata, unknown selections and absence of job/candle mutations. Set `VCP_DOWNLOAD_PREVIEW_TEST=true` with the browser test configuration above to check the preview screen. No new migrations are required.

The persisted-preview database suite and browser/API suites passed, including authentication/CSRF, input invalidation, expiry, errors, keyboard and mobile layout. When port 3001 belongs to another app, use `WEB_TEST_API_PORT=3101`, `WEB_TEST_PORT=3102`, and build with `API_INTERNAL_URL=http://127.0.0.1:3101` before testing. The harness checks wildcard port ownership and the proxied authentication endpoint. Restore the normal API target with a normal web build afterward.
