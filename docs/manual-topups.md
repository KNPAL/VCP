# Manual top-ups

Actual external BUY fills use the existing authenticated journal/fill routes. They remain facts even when cash or risk limits are exceeded. They do not create an automated ADD signal. The first actual entry and its frozen initial stop remain unchanged across top-ups.

Portfolio journal positions expose `weightedEntry`, calculated only from remaining FIFO quantities and their remaining allocated acquisition fees. Sold lots do not influence the current weighted entry. Corrections recompute this projection from the actual journal.

An explicit proposal can include `topUpQuantity` in `POST /api/v1/portfolio/risk/plans`, alongside `marketEventId`, `snapshotId` and `estimatedFees`. It requires the authenticated owner, CSRF token and idempotency key. It uses the existing position's effective stop, verifies the requested market lot and quantity against cash, company, sector, gross, per-trade and total open-risk caps, and verifies the combined FIFO entry/stop width. Fees reduce cash and the equity used for caps. Missing inputs and stale or changed journal snapshots block proposals. Broker/session/surveillance gates must also be verified; current incomplete entry integration continues to return `BUY_BLOCKED` and zero executable quantity.

Risk responses and immutable worker snapshots include `actualRisk`. Known violations produce `BREACH_ACTUAL`, even when other inputs are unavailable. Unknown cap inputs remain listed separately, and `WITHIN_OBSERVED_CAPS` does not certify reconciliation or entry permission. This evidence never reverses a fill or sends an order.

Verification: `node --test tests/actual-risk.test.mjs tests/ledger.test.mjs tests/portfolio-risk.test.mjs` and `node scripts/database-command.mjs test portfolio-risk entry-risk`. Database fixtures run only in `vcp_test`.
