# Manual downloads — KAN-145 Coded

The workspace implements owner-scoped signed-preview submission, newest-first job history, progress details, cancellation and explicit retry. The UI is at `/data/historical/download` and `/data/historical/downloads`. Existing stored data remains readable without a broker session. The deployed image has not been refreshed with this work.

## Configuration and rollout

Manual download execution is off by default. Before enabling it in an isolated test environment:

1. Apply migrations through **59** using the normal database deployment command described in the root README. Migrations 56–59 are currently applied to **vcp_test only**; the application database remains at 55.
2. Build database, API, worker and web packages. Run API and worker against the same database and Redis.
3. Generate and configure the dedicated signing key using [download authorization](download-authorization.md). Set `VCP_DOWNLOAD_PREVIEW_KEY_FILE` on the API and configure `VCP_BROKER_ACCOUNT_KEY`.
4. Set `VCP_ENABLE_MANUAL_DOWNLOADS=true` on both API and worker. Enabling only the API accepts requests that no enabled worker will prepare. The flag does not establish source permission or broker readiness.
5. Provide verified universe, instrument, calendar and source evidence, current broker authentication and readiness proofs. The preview still blocks unpopulated ranges without authoritative provider-final-session evidence.

Keep operational execution disabled until migrations and the verified workspace build are deployed. No live broker calls have been made during development.

## Public API and screens

All routes require the owner session. Writes also require CSRF. Submission, cancellation and retry require an `Idempotency-Key` header.

- `POST /api/v1/history/downloads/preview`: read-only coverage preview with optional five-minute signed `previewId`, human-readable `previewFingerprint` and `submissionEnabled`.
- `POST /api/v1/history/downloads` with `{previewId,mode}`: HTTP 202 with run ID, current status and status URL. Revalidates signed owner, expiry, pinned evidence, source permission and broker readiness transactionally.
- `GET /api/v1/history/downloads?cursor=`: up to 25 owner requests, newest first, with next cursor.
- `GET /api/v1/history/downloads/{runId}`: request, events, aggregate candle changes, window history and per-instrument progress. Reads use one repeatable database snapshot. Remaining stored-coverage gaps are distinct from remaining requested reconciliation sessions. Counts describe committed evidence; no estimated completion percentage is invented.
- `POST /api/v1/history/downloads/{runId}/cancel` with `{}`: stops future claims; a live request can finish safely. Committed candles remain stored.
- `POST /api/v1/history/downloads/{runId}/retry` with `{}`: requires valid current context and authentication, and respects an outstanding quota delay. Only incomplete requested sessions are prepared.

The preview screen retains the same submission key after a failed response. Job pages poll every five seconds, show UTC evidence formatted in IST, and expose eligible cancel/retry controls. The API remains authoritative for every action. `retryEnabled` indicates the API feature flag, not guaranteed authentication or quota availability. `dispatchAvailable: false` in the legacy read projection is not a worker heartbeat and should not be used as an operational health signal.

## Durability and worker behavior

Owner-scoped locking, submission receipts and active-request uniqueness prevent duplicate jobs. Account identity participates in request equivalence but is excluded from public responses. Immutable events record state changes. Preparation atomically links accepted work to existing HistoricalSyncRun/Window and BackfillBinding records. The existing SQL-driven BullMQ dispatcher and shared backfill gateway handle provider delivery; there is no second downloader.

Cancellation prevents new claims through a parent-row guard. Explicit retries create a new child generation without resetting historical attempts. Completed sessions from validated immutable response evidence are skipped, including accepted sessions from partial responses. Current progress excludes superseded generations where appropriate; historical attempts remain visible. Quota pauses can resume after the stored wait, while authentication pauses require explicit retry. No PIN/TOTP login is automated.

Completion requires coverage validation against the pinned calendar, not merely terminal worker windows. UNKNOWN or incomplete coverage remains PARTIAL. A dedicated BullMQ queue-loss/reconnection test now verifies SQL reconstruction, exactly the missing-session fetch, and no redispatch after completion. Acceptance review passed, including expired idempotency receipts, equivalent active requests after partial progress, and authentication loss after exhausted windows. KAN-145 is Coded. KAN-144 provider-final-session planning is Coded; KAN-125's broker connection workflow remains unfinished.

## Verification

After building packages, run `node scripts/database-command.mjs test download-preview` and `node scripts/database-command.mjs test database`. Synthetic fixtures cover authorization, concurrent/idempotent acceptance, owner isolation, immutable events, partial response retry, quota/auth pauses, cancellation during a live lease, retained candles and coverage-derived progress. Browser tests in `tests/download-preview.browser.mjs` cover expiry, changed inputs, permission failures, stable submission keys after failed responses, cancellation, job navigation and mobile layout. Use isolated API/web ports when another application owns the defaults; the web build's `API_INTERNAL_URL` must match the test API port.
