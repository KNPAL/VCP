# Historical paper portfolio

The persisted paper ledger supports FIFO cash and fees, split/bonus entitlements, source-bound fills, a separate paper loss cooldown, EOD protection plans and next-opening exits. The session runner orders these phases atomically. These commands support research; they do not execute broker orders or change the actual fill journal.

## Setup

Follow the root README to start PostgreSQL and build the workspace. Apply migrations through 52 with `node scripts/database-command.mjs migrate`. Use the existing owner's UUID in `VCP_REPLAY_OWNER_ID` and the documented `DATABASE_URL` configuration. Do not paste credentials into command arguments. Synthetic fixtures belong only in `vcp_test`.

First create a pinned archive and detector run using [historical snapshots](historical-snapshots.md) and [chronology](historical-chronology.md). All commands below run from the repository root. Replace placeholder values with the IDs returned by those commands.

```text
node scripts/historical-snapshot.mjs paper-init <run-id> 100000
node scripts/historical-snapshot.mjs paper-ledger <run-id>
node scripts/historical-snapshot.mjs paper-session <run-id> <session.json>
node scripts/historical-snapshot.mjs paper-actions <run-id> <YYYY-MM-DD> <expected-revision>
node scripts/historical-snapshot.mjs paper-opening-exit <run-id> <ISIN> <opening-UTC> <opening.json> <TRADABLE|PRICE_LIMIT_LOCKED|UNKNOWN>
node scripts/historical-snapshot.mjs paper-apply <run-id> OPENING_EXIT <opening-decision-id> <expected-revision>
node scripts/historical-snapshot.mjs paper-apply <run-id> ENTRY <entry-decision-id> <expected-revision>
node scripts/historical-snapshot.mjs paper-exit <run-id> <ISIN> <as-of-UTC> <TRADABLE|PRICE_LIMIT_LOCKED|UNKNOWN>
node scripts/historical-snapshot.mjs paper-apply <run-id> EXIT <exit-decision-id> <expected-revision>
node scripts/historical-snapshot.mjs paper-protection <run-id> <ISIN> <as-of-UTC>
```

`paper-init` pins capital once. Each mutation returns a new revision; pass it as `expected-revision` for the next mutation. Identical applied-decision retries return the existing ledger. Conflicting revisions or changes to pinned capital fail. `paper-actions` applies verified integer share entitlements before session fills while preserving exact FIFO cost and cash; missing coverage or fractional entitlements require evidence instead of a fabricated cash adjustment.

An entry decision is first created using the [entry command](historical-entry.md). Applying it recomputes cash, holdings, valuation, exposure and paper cooldown from the ledger and requires the result to match the stored decision. Risk checks include position count, stock/sector concentration, planned downside and regime gross exposure. Marks must be valid at the opening. Actual portfolio cash or a caller's inflated share counts cannot replace paper state.

`paper-exit` derives the position from its original paper entry, remaining episode quantity, applied corporate actions, prior partial-sale records and effective protection plans. It selects the pinned finalized bar and source revisions. Liquidity is an explicit research assumption: use UNKNOWN when evidence is absent. Only a `SIMULATED_EXIT` decision can be applied. A free-form historical exit whose position or scheduled sell does not match durable paper evidence is rejected.

Apply the day's exits before recording surviving positions' EOD protection. Plans are immutable and bind the ledger revision and decision time. Trailing changes take effect at the next verified session opening; a pending breakout-failure/EMA sell keeps its earliest stored decision. The exit calculation cannot use a stop created from the current session's close.

## Atomic session execution

Prefer `paper-session` over manually advancing individual phases. Its JSON input contains `session` (YYYY-MM-DD), `asOf` (a UTC instant after finalization on that session), `sourceReference`, `markets` keyed by ISIN, and an ordered `entries` array. Each market contains `opening` (the evidence object described below, or null) and `liquidity`. Each entry contains `replayEventId` and the `input` object from the historical entry workflow. The entry's `now` must be the verified session opening. Use an empty entries array on days without candidates.

The runner applies corporate actions, opening exits, ordered entries, finalized daily exits, then surviving positions' EOD plans. Cash, quantity, cooldown and effective position stops are derived from the paper ledger; portfolio marks still need valid as-of evidence. Candidate order is pinned because competition for cash affects quantities. Missing liquidity defaults to UNKNOWN and cannot create an exit fill.

Migration 52 records the complete request and phase results in the same transaction as all decisions and fills. An error rolls back that entire session. Retrying identical input returns the stored result, including under concurrent requests; changed input for a completed session is rejected. Process sessions in calendar order. Once holding a position, skipping a trading session is rejected. Empty pre-entry history can be skipped. No separate checkpoint repair is needed after a failed transaction: retry the original request. Individual phase commands remain available for inspection and controlled research, but avoid mixing them into an already completed session.

## Opening phase and evidence limits

After corporate actions, evaluate existing positions with `paper-opening-exit` before creating any new entry decisions. `opening.json` contains `price`, `sourceAt`, `knownAt` and `sourceReference`; both timestamps must equal the verified session opening. The command accepts no daily high, low or close. The opening price is an explicit pinned decision assumption, not a verified broker execution. Missing or late evidence and unknown/locked liquidity produce no fill. Positions bought at that same opening are excluded from opening exits.

A gap through the effective stop takes priority over a stored prior-day sell. Otherwise, a pending breakout-failure or EMA sell executes at the modeled opening with configured slippage and fees. Apply each `SIMULATED_EXIT` using OPENING_EXIT, then evaluate opening entries against the updated ledger. Net sale cash is visible at that opening. Migration 51 keeps opening decisions separate from finalized daily-bar decisions, so a NO_EXIT opening does not prevent an intraday exit later in the session.

Daily OHLC exit decisions are known only after the finalized bar. Even when that daily model labels a gap at the opening, its cash does not become visible to an earlier opening decision. Only the separate opening-evidence workflow can supply opening cash. Attempting to append an earlier decision after a later one fails. Do not backdate decision times to work around this restriction.

Snapshot bias, source gaps, costs and assumptions remain in the stored decisions. Paper records are marked non-executable, and performance verification remains false. Migrations 49 and 50 store immutable ledger revisions and protection plans separately from the real journal.

Validation: `node --test tests/paper-ledger.test.mjs tests/paper-protection.test.mjs tests/paper-opening-exit.test.mjs` exercises FIFO, fees, entitlements, partial positions, cooldown and no-lookahead cash. `node scripts/database-command.mjs test backtest-snapshot` uses only the isolated test database to verify source binding, retry safety, owner isolation, immutable records and unchanged actual journal counts.
