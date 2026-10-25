# Actual position cards

KAN-122 adds one card per open company ISIN to `/positions`, above the existing immutable journal and manual-fill forms. `GET /api/v1/positions/cards` is authenticated and owner-scoped.

Cards show actual quantity, remaining FIFO weighted entry and cost including allocated buy fees, verified raw mark/time, unrealized and company-history realized P&L, initial and current stops, EMA21, original R0, current R-multiple, company/sector exposure, current position action and monitoring/risk status. An unrecorded market signal never becomes a card.

All financial arithmetic runs on the server with exact fixed-point values. Unrealized P&L is mark times remaining quantity minus remaining FIFO cost. R0 per share is the original actual entry minus the initial stop; R-multiple is (verified mark minus original entry) / R0. Missing or non-positive R0 stays UNKNOWN. Top-ups and partial sales do not reset episode R0. Price-basis changes or corrected opening fills invalidate incompatible stop evidence.

EMA21 comes from a stored daily execution using the production indicator. Its session must match the current verified regime session, its adjustment revision must still be latest, and its price basis must match the position stop. Otherwise it is UNKNOWN with a reason. Quotes, portfolio observation deadlines and status deadlines are checked independently. Expired values never remain displayed as current; quantities/costs are recorded facts at the shown journal observation time.

Cards poll every five seconds and offer manual refresh. Loading, no actual positions, unknown initial capital, stale evidence, 401, 403 and 503 states are distinct. Each card links valuation/status evidence and a stored chart where available. Native details/buttons, mobile stacking and IST timestamps with raw quote age are supported. Cards perform no financial writes or broker calls.

Verification:

```sh
node --test tests/position-cards.test.mjs
node scripts/database-command.mjs test position-cards
```

Set `VCP_POSITION_CARDS_TEST=true`, `WEB_TEST_PORT=3002` and the browser variables described in [inspector.md](inspector.md), then run `node scripts/database-command.mjs test-web` for isolated browser checks. Financial browser fixtures are intercepted responses, and database tests run only against `vcp_test`.
