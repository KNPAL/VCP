# Historical daily replay (KAN-112)

`replayDailyChronology` walks verified calendar sessions in order and reconstructs a fresh point-in-time slice for every decision. It calls production `dailyBreakout` against the previous frozen primary before calling `detectDailyStructure` for the new close. The production detector enforces the three-right-bar pivot confirmation rule. A corporate-action basis change invalidates the previous primary. Missing or non-finalized coverage clears it rather than carrying an old pattern through a gap.

The default decision instant is the calendar finalization timestamp. An archived `ReplayAssumption.decidedAt` can explicitly select a later instant in that same session (for example, the scheduled scan after provider receipt). It cannot precede finalization or exceed the pinned archive cutoff. Prices received after the chosen instant remain unavailable.

Optional per-session assumptions record portfolio, market and quote state, source reference and knowledge time; only strength evidence known by the decision instant enters the detector. Missing assumptions are visibly UNKNOWN. Replay never reads the current portfolio, live quote cache or current market state. It accepts only the supported production strategy configuration hash; the supplied source SHA remains pinned in the archive.

A confirmed close breakout records `earliestFillAt` only when the next opening is verified and known, with complete intervening holiday coverage. It never creates a same-day fill, actual order or portfolio journal entry. Fill prices, fees applied to trades and portfolio simulation are separate KAN-113 work. Costs, bias and data limitations accompany each event; none is a verified performance claim.

Migration 46 stores the immutable run and daily events together in one transaction. Each event has owner, run, session, historical source/occurrence/decision/effective timestamps and pinned revisions. The run's `recordedAt` is the actual persistence time; historical event timestamps are explicitly simulated. A transaction failure rolls back both the run and all events, so retry cannot observe a partially completed run. Concurrent retries return one run. Reconnected readers retrieve the same ordered events.

After migrations and a workspace build, use the same environment configuration as the [snapshot commands](historical-snapshots.md):

```powershell
node scripts/historical-snapshot.mjs replay <snapshot-id> C:\archives\assumptions.json
node scripts/historical-snapshot.mjs events <returned-run-id>
```

The optional assumptions file is an array matching `ReplayAssumption` in `packages/backtest/src/chronology.ts`. Omitting it records UNKNOWN historical assumptions. The golden fixture is synthetic and uses a calendar with every fixture day marked trading; it is never a claim about actual exchange history.

Checks: `tests/backtest-chronology.test.mjs` verifies the full golden pattern, exact confirmation timing, next-opening eligibility and deterministic serialized replay. `tests/backtest-snapshot.integration.mjs` verifies concurrent retries, owner isolation, immutable event records and reconnect recovery in `vcp_test`.
