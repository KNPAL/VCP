# Manual download acceptance — KAN-145 In Progress

The internal `acceptManualDownload` service verifies a signed owner-bound preview and re-reads current evidence inside a serializable transaction. It checks current licensing, broker readiness and unchanged universe/instrument/calendar/candle revisions before accepting work. The account identity is pinned privately in the accepted evidence and participates in request equivalence; it is omitted from the read projection.

Migration 56 adds durable `ManualDownloadRun`, `ManualDownloadSubmission` and immutable `ManualDownloadEvent` records. An owner-scoped transaction lock, idempotency receipt and active-request uniqueness constraint prevent duplicate acceptance. The request hash includes the broker account, requested range/mode and evidence binding. Equivalent active requests reuse the same run, even with different idempotency keys; reuse of one key for different evidence or mode fails. Serialization/deadlock conflicts have a bounded retry. A repeated valid receipt returns the original run without producing another event.

`readManualDownload` requires the same owner and returns pinned request evidence, UTC timestamps and durable events without exposing the private broker account identity. It explicitly reports `dispatchAvailable: false`.

## Not yet available

This is an internal acceptance service, not a public submission endpoint. No worker consumes these manual requests yet. Existing operator backfill behavior is unchanged. Do not call the internal service operationally until dispatch integration is complete. Public submission controls remain disabled.

Remaining work includes translating accepted plans into the existing sync windows and credential/source bindings, recoverable BullMQ delivery, aggregate coverage/progress, auth/quota pauses, cancellation, explicit resume/retry, API endpoints and UI. Completed windows must not be redownloaded except for an explicit reconciliation plan; failed-window retry budgets must not be reset silently. Completion must follow coverage verification.

Migration 56 has been applied to **vcp_test only**. The deployed application database remains on migration 55; no deployment has been made. Apply the migration through the normal deployment workflow when the feature is ready.

Verification uses only synthetic fixtures in `vcp_test`: signed-preview acceptance, identical and concurrent equivalent submissions, conflicting-key rejection, immutable events, owner isolation and account-identity non-disclosure. Run `node scripts/database-command.mjs test download-preview` after building the database and API packages. No broker calls, worker jobs or real financial data are involved.
