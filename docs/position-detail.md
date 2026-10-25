# Position detail

Open **Positions**, then select a company ISIN on its actual-position card. The authenticated `/positions/<ISIN>` screen reads the owner's recorded portfolio and stored evidence.

- Original fills, reversals and replacements stay visible. FIFO lots show remaining quantities and unallocated buy fees; actual partial sales show consumed lots and realized P&L. Attributed dividend/corporate cash records remain distinct from fills.
- The current stop/status expires with its backend evidence. Historical records remain visible after expiry and are not presented as current signals.
- The immutable timeline includes initial stops, trailing revisions and their effective times, protective/EMA/failure alerts, 2R partial suggestions, monitoring/status observations, cash attribution, resolutions and review acknowledgements. It loads fifty records at a time with a timestamp-bounded cursor.
- Verified effective split/bonus source events are displayed separately from broker quantities. A source event does not manufacture an execution or automatically reconcile live holdings. Prior entry pivots link to the stored chart execution.
- **Acknowledge review** records one immutable note per owner/alert. Identical retries return the same record; a different note conflicts. Acknowledgement does not resolve an alert or change cash, holdings or fills.
- **Record actual SELL** requires an already executed fill, quantity, price, fees, IST execution time, broker reference and explicit confirmation. The existing journal API enforces FIFO/oversell rules and idempotency. No broker order is sent.

Migration 53 adds immutable `PositionAlertAcknowledgement` records. Apply migrations using the root README instructions before running the updated API. All synthetic verification runs against `vcp_test` only.

Verification: `node scripts/database-command.mjs test position-detail`; for the browser harness set `WEB_TEST_PORT=3002`, `VCP_POSITION_DETAIL_TEST=true` and the Playwright module/browser settings described in the README, then run `node scripts/database-command.mjs test-web`. Browser mutation requests are intercepted; the database test checks paging, owner isolation, concurrent retries, non-execution and immutability.
