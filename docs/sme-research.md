# SME research (KAN-137)

The authenticated `/research/sme` page is research only. `BUY_BLOCKED`, `buyEligible: false`, `executable: false` and `guaranteedFill: false` remain true restrictions even when every source is known. A new validated policy is required before any actual recommendation; this feature provides no approval bypass.

The backend reads immutable reviewed SME metadata, a finalized exchange calendar and pinned adjusted/raw candle evidence. It shows the verified exchange segment and trading lot, 20-session median raw turnover, surveillance flags/cash tradability, price bands, corporate-action revision and reviewed thin-execution assumptions. Missing lot, restrictions, liquidity, action data or assumptions remain UNKNOWN. Observed zero turnover or current surveillance restrictions produce RESTRICTED. No OHLC observation implies an executable fill.

After building and applying migration 55, operators with the existing secret-backed `DATABASE_URL` can run:

```text
node scripts/sme-research.mjs import <reviewed-sme.json>
node scripts/sme-research.mjs list
node scripts/sme-research.mjs view <listing-uuid>
```

The reviewed input follows `SmeResearchEvidence` in `packages/market-data/src/sme-research.ts`: canonical listing UUID/ISIN; exchange; `segment: "SME"`; exact `exchangeSegmentCode` from the verified instrument master; `segmentVerified`; positive integer `lot` or null; `lotVerified`; UTC `knownAt`; a complete `SourceRecord`; nullable surveillance evidence; and nonempty reviewed `thinExecutionAssumptions`. The operator must verify the source's SME classification; a supplied verification flag is not independent exchange confirmation. Verified identity, exchange segment code and lot must match an effective verified equity instrument mapping.

`SourceRecord` uses the existing [source registry permission and freshness contract](registry-readiness.md). Explicit current STORE permission is required to import. DISPLAY and DERIVE permission are checked before loading/deriving candle observations; unavailable or denied permissions hide research values. Missing/unverified surveillance flags stay null; they are never interpreted as clearance. Expired surveillance evidence is hidden even if its historical flags were restricted. The page masks current facts at the earliest source/surveillance expiry and requires refresh.

Imports are content-addressed and immutable. A correction appends a new known-time revision; an unpermitted new revision does not silently reuse older displayed facts. No import changes the live strategy, readiness proofs, portfolio ledger or broker connection. No external data is downloaded by this workflow.

The metadata source must use dataset `SME_METADATA` and must match the current source-registry record exactly. Register it with `node scripts/source-registry.mjs import <reviewed-source.json>` before importing research metadata. Storage and retries lock the source scope and recheck authority. List/detail reads consult the registry again; revocation hides affected identities and research values even while an old embedded grant remains unexpired. The list reports withheld revision IDs through `unavailable` and a `BLOCKED_DATA` state.

Use the unit and isolated PostgreSQL suites `tests/sme-research.test.mjs` and `node scripts/database-command.mjs test sme-research`. Synthetic fixtures belong only in `vcp_test`.
