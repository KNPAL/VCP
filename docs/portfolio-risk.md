# Portfolio valuation and risk evidence

Migration 35 adds immutable `PortfolioRiskSnapshot` evidence. Apply migrations using `node scripts/database-command.mjs migrate`, build the packages and restart API, worker and web using the root README instructions.

The held-position worker records snapshots after protective monitoring. Quotes come from the fenced live cache; no public endpoint accepts prices, verified flags or risk-gate approvals. Without a configured live stream, verified calendar, instrument/sector mappings and corporate-action coverage, the application displays explicit missing-input reasons.

`GET /api/v1/portfolio` includes the actual journal and risk view. `GET /api/v1/portfolio/risk` returns valuation, source times and mark ages, company and sector exposure, planned stop-level downside, reconciliation evidence and separate entry-plan reasons. Both require an owner session.

Cash comes from actual signed journal events, including fees and corrections. Equity adds current verified raw marks to cash. All arithmetic uses exact six-decimal integers. Multiple holdings of the same ISIN count as one company. A missing or expired mark makes its company and sector totals unknown; it never silently contributes zero or a stale numeric subtotal. Missing stops block planned downside independently. Unverified or changed share-price scales quarantine valuation until supported evidence exists; automatic split/bonus quantity reconciliation remains unfinished.

Snapshot creation and reads hold the same owner row lock as journal writes. Evidence binds to the complete journal hash. A later fill or correction invalidates the previous snapshot's marks. Reads also recheck current mappings, sector, calendar and stop/action basis. Snapshot validity is at most 30 seconds, shortened by quote freshness, heartbeat and lease deadlines. Quote validity is checked after waiting for the lock. Historic evidence is never updated or deleted.

**My positions** displays exposures and explicit reasons, refreshes every five seconds, and hides current valuation when its deadline passes even if polling fails. Actual holdings remain visible.

Entry plans remain `BUY_BLOCKED`: durable market-regime, broker/readiness and candidate-quote integrations are still pending under KAN-93/94/96 and their dependencies. A valuation does not approve a BUY, guarantee a stop execution or create an actual fill.

## Entry-plan audit API

Migration 36 adds immutable `EntryRiskPlan` records. Authenticated `POST /api/v1/portfolio/risk/plans` accepts only `marketEventId`, `snapshotId` (from the risk endpoint) and a nonnegative exact-decimal `estimatedFees` string. Include the session's CSRF token and a unique `Idempotency-Key`. Prices, stops, regime values and approval flags cannot be submitted.

The server loads the stored market event, canonical listing, current action basis, calendar and snapshot quote under the portfolio owner lock. It checks the event window, chase limit and structural stop, then retains available independent cap calculations and explicit unknowns. The current quote collector covers held positions; new-candidate subscriptions are still pending. Missing inputs persist a blocked plan rather than manufacturing an approval. Zero quantity and `executable:false` are enforced while the remaining evidence paths are unfinished.

Plans expire no later than their originating snapshot or quote. Changed journals and superseded snapshots reject new requests with HTTP 409. Retrying an identical key returns the original historical record, including its original expiration; it never refreshes validity. Changed retry payloads also return 409. `GET /api/v1/portfolio/risk/plans` returns up to 50 owner-scoped records with current validity reasons, while preserving original evidence. Neither route writes fills, cash movements or broker orders.

Sizing now reports each independently computable cap even when another cap is unknown. Unknown caps remain null and block final quantity. The five-position gate uses actual ISIN membership, so an unmarked existing holding is not incorrectly counted as a new sixth position when evaluating a top-up.

Verification:

```powershell
node scripts/database-command.mjs test database portfolio-risk entry-risk
pnpm test
pnpm lint
```

The integration suite uses only `vcp_test`. It checks partial sales, corrections, concurrent snapshots/fills, deadline expiry while waiting on the owner lock, changed price scales, immutable history and owner isolation. `tests/portfolio-risk.browser.mjs` covers deadline expiry and mobile layout with synthetic HTTP responses; it does not insert application financial records.

Entry-plan integration also covers concurrent duplicate requests, conflicting retries, stale journal rejection, immutable evidence, owner isolation, and unchanged actual holdings after plan creation. API checks cover authentication, CSRF and rejection of client-supplied regime fields.

Migration 37 connects the [actual loss-streak gate](loss-streak.md), including corporate-cash allocation and verified-session cooldowns. Entry plans retain its result and allocation revision; corrected allocations invalidate old plan evidence.

