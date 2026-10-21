# EMA21 trailing protection

Migration 39 adds immutable daily `PositionTrail` evidence. Rebuild database, API and worker after applying migrations. The held-position worker evaluates live protective stops for every owner before doing EOD trailing work. No live quote is needed to calculate a finalized EOD candidate; a fresh verified quote is still required to trigger a protective SELL.

The first actual BUY and frozen initial stop define R0. A verified completed close at or above first entry + R0 activates trailing, including historical closes recovered after a restart. Subsequent top-ups do not reset that anchor. Corrected first fills, missing/changed price scales, incomplete calendars and unavailable final series cannot create a usable update.

The candidate is EMA21 minus half ATR14, rounded down to the listing tick. The active stop never decreases. Updates take effect at the next verified tradable session opening; late recognition uses its actual recognition time and never backdates protection. A candidate at or above the latest close emits a next-session SELL_EMA_CLOSE alert while retaining the old protective stop. EMA_WEAKNESS alone is informational.

The owner lock serializes trailing changes with actual fills. Repeated and concurrent processing preserve the first accepted daily evaluation. The stop audit endpoint includes `trails`, original `stops`, and the currently effective stop for each open position. `initialStop` retains the original stop in each current record. Portfolio valuation and protective monitoring consume the same effective stop. Signals remain suggestions: only actual journal fills change holdings.

Verification: `node --test tests/trailing-stop.test.mjs` and `node scripts/database-command.mjs test position-trail protective-stops`. These cover the +1R boundary, floor-to-tick behavior, monotonicity, missing/unfinalized inputs, EMA close alerts, deferred effectiveness, duplicate workers, gap protection and unchanged actual fills. Multi-rule exit precedence is tracked separately under KAN-102.
