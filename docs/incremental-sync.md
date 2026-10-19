# Incremental EOD synchronization (KAN-36)

`prepareIncremental` reads committed raw-candle inventory for one listing/provider and pins an immutable INCREMENTAL run. It selects missing finalized sessions plus the last three completed sessions from the supplied verified calendar. Holidays are explicit, special sessions count, and not-yet-final sessions are excluded. Unknown calendar coverage queues nothing. Requests never exceed 400 calendar days, including recovery after a long outage.

The run uses the same bound-window worker as initial backfill: immutable source/mapping/credential references, current source permission checks, credential resolution, account-wide Redis budget, bounded transport, response normalization, fenced leases, transactional ingestion/checkpoints and SQL-driven lost-job recovery. Queue messages carry only the run UUID. The existing `backfill` queue name denotes this shared window executor for both modes.

Each successful window atomically stores candle hashes/revisions, coverage and its checkpoint. Unchanged overlap creates no new revision. Corrected bars create immutable change events. Failed fetches commit no bars for that window; previously committed windows survive retries. A truncated window retains explicit missing-session evidence and follows the existing subdivision/failure policy. Stored coverage and successful response completeness remain separate measures.

Reusing a run UUID resumes its original plan, even after inventory changes. Changing range, listing/provider, calendar, timestamp or mode under that UUID is rejected. A later EOD evaluation uses a new UUID and a freshly verified calendar/source binding. No credentials are embedded in run evidence.

## Operator submission

After building the worker, run `node apps/worker/dist/submit-incremental.js <protected-input.json>` with `DATABASE_URL` configured. The running worker needs Redis settings and `BROKER_KEY_DIRECTORY`, as described in broker-credentials.md. The input has:

```json
{
  "preparation": {
    "id": "<new run UUID>",
    "listingId": "<stored listing UUID>",
    "provider": "ANGEL_ONE",
    "from": "<inventory start YYYY-MM-DD>",
    "to": "<latest session YYYY-MM-DD>",
    "asOf": "<UTC evaluation timestamp>",
    "calendar": []
  },
  "binding": {
    "credentialReference": "<provisioned credential UUID>",
    "instrumentSnapshotId": "<stored mapping revision>",
    "sourceSnapshotId": "<stored licensed source revision>",
    "exchange": "NSE",
    "symbolToken": "<verified provider token>"
  }
}
```

This is a schema example, not runnable market evidence. Populate `calendar` with verified entries for every date in the inventory interval. An empty calendar returns a sanitized submission failure. Submission can leave an unbound run if binding fails; it cannot dispatch without a valid binding, and retrying the same input safely completes binding. Job progress remains available through `/api/v1/system/jobs`.

## Downstream handoff

The change dispatcher persists replay requests with plan version 2: iterate sessions in ascending order, compute indicators, evaluate the market signal against the frozen previous-session READY snapshot, then recompute current-session VCP and scan outputs. Prior immutable version-1 receipts are preserved and returned as stored on duplicate delivery; a replay executor must explicitly migrate or reject their old order, never silently interpret them as version 2.

This ticket supplies durable incremental ingestion and the ordered replay request. Executing replay remains KAN-60, whole-universe orchestration KAN-73 and automated calendar scheduling KAN-21. No completed replay or live broker acceptance is implied.

Synthetic tests cover three-session selection, gaps, holidays/special sessions, delayed finalization, oversized ranges, repeated delivery, changed input conflicts, broker failures, truncated responses and a corrected overlap flowing into an immutable replay request.
