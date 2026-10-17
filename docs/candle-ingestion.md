# Raw candles and calendar evidence

KAN-31/34/49: raw_daily identity is listing UUID, exchange session and provider. Database constraints enforce valid positive OHLC, nonnegative integer volume and finalization before receipt. Verified calendar input explicitly represents every calendar date in a requested range, including holidays and special sessions. Missing calendar dates are UNKNOWN; weekdays never stand in for exchange verification. Instrument finalization must follow the verified session's finalization, including auction time. Zero-volume data requires verified classification.

The ingestion transaction retains normalized-content SHA256, immutable prior/current CandleRevision rows, raw current projection, change outbox, quarantine evidence, calendar snapshot hash and coverage watermark. Unchanged semantic content (including decimal formatting differences) produces no change event. A changed bar requires a later observation time. Conflicting duplicate bars in one response are both quarantined. No gap interpolation occurs.

Watermarks advance only through consecutively covered verified completed sessions; unknown calendar or missing sessions cannot advance them. Requested/expected/returned counts remain separate. A failed or partial response may coexist with older stored coverage; its actual response counts are not rewritten as a successful fetch.

PostgreSQL integration verifies same-content retries, corrected before/after revisions, immutable outbox/calendar, quarantine and invalid OHLC rejection. Unit fixtures cover holidays, special sessions, auction finalization, zero volume, contradictions and source mismatch.

KAN-35 remains In Progress: transaction and change outbox are implemented, but the outbox-to-worker replay delivery remains to integrate. Broker fetches, quotas, initial backfill, corporate actions and production verified calendar ingestion are not yet implemented. All test candles/calendar dates are explicitly synthetic and isolated from the application database.
