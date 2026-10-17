# Actual portfolio journal

KAN-88–91 use an append-only PostgreSQL journal, single-owner serializable transactions and immutable idempotency responses. Every event records UTC execution and knowledge times, source reference, author and sequence. Actual events are distinct from alerts and plans. Neither recording a fill nor a cash movement sends a broker order.

The first event must be explicit verified INITIAL_CAPITAL. Deposits, withdrawals, fees, dividends and corporate cash flows retain signed cash entries. Actual BUY cash is minus quantity times price and fees; actual SELL cash is proceeds minus fees. Negative factual cash is retained for reconciliation rather than silently changed. Missing initial capital is UNKNOWN.

FIFO groups holdings by ISIN across exchanges. Partial sales consume oldest acquisition lots including their fees. Fee allocations round down to six decimal units, leaving the exact residual for the final disposal of a lot. Oversells fail. Duplicate broker execution references fail even with a different idempotency key. Same-key retries return the original result; changed same-key payload returns 409.

Corrections preserve the original, append its signed reversal, then append a linked replacement in one transaction. FIFO is replayed in execution-time order; timestamp ties inherit the corrected fill's original sequence. A correction that would cause an oversell is rejected atomically. Queries before the correction's recordedAt retain the original view.

Authenticated, origin/CSRF-protected mutations:

- POST /api/v1/portfolio/cash: kind, decimal amount, verified:true, occurredAt, sourceId.
- POST /api/v1/positions: actual BUY, isin, side, integer quantity, decimal price/fees, brokerReference, occurredAt, sourceId.
- POST /api/v1/positions/{isin}/fills: same fill body without isin; BUY or SELL.
- POST /api/v1/positions/fills/{fillUuid}/correct: reason and replacement fill body.

All require Idempotency-Key. GET /portfolio returns the journal, cash, FIFO cost basis and realized P&L; GET /positions returns open holdings. Live valuation and reconciliation remain explicitly unknown until connected verified marks and outside activity are available.

The Positions UI reads the journal, records verified cash and actual fills, and displays immutable corrections. Live stops/marks/EMA/risk display and correction editing remain unfinished under KAN-122/123. Shared valuation/risk sizing under KAN-92–94 passes isolated boundary tests but still needs durable source snapshots and endpoint integration. New BUY plans cannot use unverified marks.

PostgreSQL tests exercise concurrent same-key requests, changed payload conflict, competing oversells, append-only corrections, FIFO replay and authenticated API writes. Unit tests include fractional fee allocation, partial liquidation, missing capital, duplicate execution reference and point-in-time correction visibility.
