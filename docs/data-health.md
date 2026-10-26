# Universe and data health (KAN-125, In Progress)

After signing in, open `/universe`. The screen reads persisted universe membership, instrument mappings, completed scan evidence and current scan progress independently. Counts from different revisions are labelled separately. Coverage comes from the existing verified-calendar coverage service; missing evidence is UNKNOWN, never zero or complete. Latest finalized candles exclude records whose finalization or receipt is in the future.

The screen includes supported/unsupported segments, provider selection, candle gaps, source gates G01–G10, expired proof warnings, and the first 50 sync-window checkpoints with retry reasons. Refresh runs every 15 seconds after the previous request finishes. Manual refresh also reloads coverage even if the health snapshot timestamp is unchanged. Saved research groups remain available through `/watchlists`.

Authenticated read-only endpoints:

- `GET /api/v1/data/health`
- `GET /api/v1/broker/angel-one/status`
- `GET /api/v1/system/coverage/{listingId}?provider={provider}`

For the current operator-provisioned broker session, set `VCP_BROKER_ACCOUNT_KEY` in the API process to the existing 64-character lowercase hexadecimal account key used during credential provisioning. Restart the API after changing its environment. If unset, the status is NOT_CONFIGURED; this does not prevent stored-data browsing. This setting is an account selector, not an API key or token. The response never returns credential envelopes, tokens, session revisions or the account key.

Status currently reflects the stored verified circuit/session and unexpired G01/G07 proofs. It does not make a fresh provider authentication request or prove WebSocket connectivity. A disconnected broker or failed status request does not suppress the independent stored-data response.

## Outstanding acceptance

KAN-125 is not complete. Browser broker configuration/login, manual historical-download submission, aggregated download-run progress/counts and manual retry controls are still pending. Their navigation routes exist, but the download button is deliberately disabled with an explanation. Existing sync windows are explicitly labelled as windows, not aggregated download jobs. Exhausted retry budgets must not be bypassed by resetting failed windows. The documented [operator backfill workflow](backfill.md) remains the implemented submission path.

KAN-144, a dependency outside the original KAN-4–139 range, is In Progress. Its local `previewDownloadRange` planner reuses verified-calendar and candle validation, computes missing-only windows, and refreshes the last three finalized requested sessions in RECONCILE mode. It excludes holidays, pre-listing dates and unfinished sessions; unknown calendars return UNKNOWN, and absent provider-final-session evidence blocks execution while preserving local coverage findings. Requests are bounded to five years and 400-day windows. This pure planner does not query the database, issue a usable preview token, enforce source licensing or dispatch jobs. Persisted permission/revision binding, universe canonicalization, five-minute preview identity and authenticated API integration remain necessary before KAN-144 can be Coded.

No new migration is required. These changes are currently in the workspace; the deployed local image still contains the previous KAN-127 release.

## Verification

Database/API/web builds and lint passed. Two isolated `vcp_test` database tests cover unknown coverage, unsupported segments, immutable scan evidence, future snapshot/candle exclusion, account-specific broker circuits, expiry and credential non-disclosure. The browser suite covers refresh, source revisions, broker failure, expired proof, UNKNOWN, loading, empty, 403/503 recovery, keyboard controls and mobile overflow. Authenticated API checks also verify both new endpoints reject anonymous access. All fixtures are synthetic and isolated from `vcp`.

Run database checks with `node scripts/database-command.mjs test data-health`. For browser checks, build the web app, set `WEB_TEST_PORT=3002`, `VCP_DATA_HEALTH_TEST=true`, and configure `VCP_PLAYWRIGHT_MODULE`/`VCP_BROWSER_CHANNEL` for the installed Playwright browser, then run `node scripts/database-command.mjs test-web`. The browser harness needs API port 3001 free; never use port 3000 when another app owns it.
