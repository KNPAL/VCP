# Breakout failure and partial profit

KAN-99 evaluates completed sessions after the first actual BUY. Two consecutive closes strictly below the frozen pivot within the first five subsequent trading sessions produce one immutable breakout-failure SELL. Equality resets the consecutive-close condition. Missing calendar, price-scale or bar evidence cannot produce a SELL. The signal is effective at the next verified session opening, or recognition time if recognition is later. Signals never create fills.

KAN-100 evaluates fresh LTP against first entry plus twice the initial risk. Later trailing stops do not change that threshold. Suggested quantity is one third of the current holding, rounded down to the permissible market lot; zero quantity produces no alert. One signal is retained per position episode, including after dismissal or resolution. Concurrent worker attempts serialize under the portfolio owner lock.

The worker evaluates live protective exits, then EOD exits, then partial profit. Any full SELL cancels a pending partial in the same transaction. Actual journal SELLs resolve the partial after its suggested quantity is recorded; closing the episode resolves remaining proposals without claiming a signal execution. No alert modifies holdings or submits a broker order.

`GET /api/v1/positions/stops` returns owner-scoped initial stops, trailing/failure evidence, partial signals and immutable resolutions. `POST /api/v1/positions/partials/{id}/dismiss` accepts `{ "reason": "..." }`, requires the authenticated session, CSRF header and `Idempotency-Key`, and records an explicit dismissal. Retrying the same request returns its original result; changed input under the same key conflicts.

Apply migrations 40 and 41 before running the rebuilt API or worker. Verify with `node scripts/database-command.mjs test position-trail partial-profit database`; fixtures are restricted to `vcp_test`.

## Primary action and actual closure

Migration 42 adds immutable primary exit decisions and full-exit resolutions. Priority is protective SELL, breakout-failure SELL, EMA-close SELL, then partial profit. Recognized next-session exits remain visible with `effective: false` before their scheduled opening. Missing exit evidence returns `NO_EXIT_SIGNAL`; it does not imply a verified HOLD.

Protective and EOD evaluations record decisions under the portfolio owner lock. The worker reconciles the complete set after partial-profit evaluation. Lower-priority EOD signals retain their source evidence but do not emit a new SELL notification when a higher-priority signal already exists. Repeated unchanged evaluations reuse the same decision identity. Actual journal closure resolves outstanding full exits as `CLOSED_WITHOUT_SIGNAL_EXECUTION`, independently of whether a user followed an alert.

The stops endpoint includes `exitDecisions` (latest per episode) and `exitResolutions`. Candidates include source revision and recognition/effectiveness timestamps. Source signals and original decisions are never rewritten.
