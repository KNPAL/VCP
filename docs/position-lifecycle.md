# Position lifecycle and monitoring history

Actual journal fills establish OPEN, PARTIALLY_EXITED and CLOSED. Full-exit recommendations add EXIT_ALERTED without changing actual quantity or the separate actual-fill state. A partial-profit proposal alone never implies a partial execution. Corrections and same-timestamp close/reopen events use the journal's original FIFO ordering.

HOLD requires a verified current quote, an effective stop in the current corporate-action scale, current applicable trailing and breakout-failure evidence, and a known partial-profit result. EOD rules are not applicable until a completed session follows the actual entry. Closed-but-unfinalized sessions, stale indicator sources, unavailable calendar/mapping, or missing rule inputs prevent HOLD. A retained protective SELL remains visible during an outage, with MONITOR_DEGRADED health. No recommendation guarantees safety.

Migration 43 stores immutable status history. Actual fill transitions commit with the journal; the worker records evaluated status after exit precedence. Repeated identical evaluations are deduplicated within a ten-second observation window. Status expires after at most 15 seconds and never outlives the quote or session. Reads recheck journal, mapping, calendar and adjustment revisions; old HOLD observations become UNABLE_TO_EVALUATE.

`GET /api/v1/positions/status` requires the owner session and returns the latest observation per episode plus the latest 100 history entries. The Positions page displays actual fill state, monitoring health and recommendation separately. Network failures preserve the historical evidence with a warning and cannot keep displaying a current HOLD.

Run `node scripts/database-command.mjs test position-status database`. For the optional browser check, set `WEB_TEST_PORT=3002`, `VCP_BROWSER_TESTS=true`, and a configured `VCP_PLAYWRIGHT_MODULE`, then run `node scripts/database-command.mjs test-web`. The runner uses `vcp_test`, starts temporary API/web processes, and stops them afterward.
