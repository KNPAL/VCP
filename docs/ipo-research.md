# IPO research (KAN-136)

This separate research profile never produces live BUY eligibility. It shows confirmed high/low legs after at least 30 completed, verified daily sessions. Swings use the production three-bar confirmation rule. No SMA200, 252-session range, RS250 or issue price is manufactured from short history. The page explicitly leaves these unavailable metrics UNKNOWN.

After building the workspace and applying migration 54, use the authenticated **IPO research** navigation item (`/research/ipo`). Missing metadata, unverified sources, missing adjusted candles or incomplete exchange calendars remain UNKNOWN. Twenty-nine verified bars yield INSUFFICIENT_HISTORY; thirty permit structural observations only. There is no claim that these observations pass the main VCP strategy.

An operator with an existing database connection can import reviewed listing facts:

```text
node scripts/ipo-research.mjs import <reviewed-listing.json>
node scripts/ipo-research.mjs list
node scripts/ipo-research.mjs view <listing-uuid>
```

Set `DATABASE_URL` using the same secret-backed environment as the other operator scripts. Never put credentials in the JSON. The input fields are `listingId` (existing canonical listing UUID), `isin`, `listingDate` (exchange date), `issuePrice` and `listingPrice` (positive decimal strings or null), `knownAt` (UTC ISO instant), `sourceReference`, `permissionReference`, and `verified` (boolean). Import unreviewed evidence with `verified: false`; only set it true after checking the actual source, identity, prices and permitted use. A permission reference records the review evidence; it does not grant a data licence. Missing prices must be null.

Verified imports must match an already verified equity instrument mapping for the same listing UUID, ISIN and listing date, known by the metadata cutoff. Imports append content-addressed immutable snapshots. Corrections append new knowledge-time revisions; they never overwrite history. A newer unverified revision does not fall back to a previously verified price. Future knowledge and a listing price dated before listing are rejected. This script makes no external data requests and changes no broker readiness gate, strategy profile, cash or fills.

Structural observations read the latest stored adjustment revision and a verified finalized calendar through the existing source loader. Every raw candle must already exist and be known at the observation cutoff. The page exposes metadata, adjustment and calendar revisions, source session and raw source age. These are historical observations, not fresh live quotes.

Verification uses `node --test tests/ipo-research.test.mjs` and `node scripts/database-command.mjs test ipo-research`; synthetic data belongs only in `vcp_test`.
