# Historical snapshot selection (KAN-111)

`@vcp/backtest` pins a detached, recursively frozen, content-addressed archive. It includes strategy configuration/hash and source SHA, seed, explicit buy/sell/slippage basis points and minimum fee with source reference, universe membership, instrument mappings, exchange calendar, raw revisions and corporate-action snapshots. The archive hash covers every field; a separate data revision pins raw/action evidence. Each historical slice identifies its finalized-adjusted revision and exact raw revision IDs.

Selection shares the production `universeAt`, `canonicalListings`, `verifiedCalendar`, `validateCandle` and `adjustCandles` functions. A decision can see only received, finalized bars and action/membership/mapping evidence known at its timestamp. Later corrected bars and splits cannot rewrite earlier decisions. Calendar gaps, unavailable actions, missing prices and unverified membership remain explicit. Missing historical delisting coverage or constituent evidence produces `SURVIVORSHIP_BIASED_RESEARCH`. All output is non-executable and never claims verified strategy performance.

Migration 45 stores the full archive and owner, request ID, source/occurrence/decision/effective timestamps and strategy/data revisions in immutable PostgreSQL evidence. Concurrent identical requests return one event; reusing a request ID with changed inputs fails. A reconnect reads the same archive. Redis is not involved.

After workspace install/build and database migration, an operator can supply an archive matching `HistoricalInputs` in `packages/backtest/src/index.ts`:

```powershell
# Set DATABASE_URL through your local secret configuration and VCP_REPLAY_OWNER_ID
# to the existing Owner UUID. Never commit either environment configuration.
node scripts/historical-snapshot.mjs pin research-001 C:\archives\historical-inputs.json
node scripts/historical-snapshot.mjs slice <returned-snapshot-id> 2026-10-20T11:00:00Z
```

The import is deliberate: a current provider download is not proof of what was known historically. Do not backdate reception timestamps. Synthetic fixtures belong only in `vcp_test`. Missing historical evidence produces research limitations, not fabricated coverage.

This ticket provides snapshot selection and durable pins. Chronological strategy replay, simulated fills, reports and a backtest UI remain separate tickets. No broker or external data provider is contacted by this command.

Validation: `node --test tests/backtest-snapshot.test.mjs`; `node scripts/database-command.mjs test backtest-snapshot`. Tests cover content integrity, detachment, serialized recovery, future corrections/actions, bias and gaps, invalid costs, duplicate raw revisions, concurrent retries, immutable SQL records and owner isolation.

The chronological detector is now implemented separately in [KAN-112](historical-chronology.md). Fill simulation, reports and UI remain separate tickets.

