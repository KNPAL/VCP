# Instrument identity and external readiness

Companies use stable UUID/ISIN identity; exchange listings have independent UUIDs. Provider tokens and symbols belong to effective-dated mapping versions. Full normalized master snapshots are immutable, source-referenced and knowledge-dated. Mapping validity is half-open [from,to), and PostgreSQL excludes overlapping ranges for a listing/provider within a snapshot. Identity conflicts fail rather than replacing an existing company or listing.

Canonical selection prefers one verified enabled NSE EQ equity listing, then one verified enabled BSE cash equity listing. Ambiguity, unsupported ETFs/indexes/derivatives, missing mapping or unverified source gives UNKNOWN with reasons. Other exchange mappings remain available for research. The [instrument-master importer](instrument-master.md) accepts raw SmartAPI JSON with independently reviewed mappings, explicit tick units and current STORE/DERIVE permission. Missing identity, mismatched precision and duplicate tokens are quarantined with immutable row reports. Source acquisition remains an operator-provided licensed file.

NIFTY 500 universe snapshots retain effective and knowledge dates and source references. Each scan pins immutable universe membership and canonical mappings. Missing historical constituent verification explicitly labels SURVIVORSHIP_BIASED_RESEARCH. Sector snapshots retain per-ISIN effective ranges and source references, reject overlap, and return UNKNOWN for missing current mapping.

GET /api/v1/sources/readiness returns all G01–G10 statuses, source/probe timestamps, expiry, proof, allowed/blocked capabilities and exact failure policy. Missing proof is UNKNOWN; expired passing proof cannot remain PASS. The application database contains no artificial passing proofs. A source registry separately records permitted download/storage/derivation/display/redistribution, license references, freshness and coverage.

Benchmark and surveillance validators have fixtures for 252 aligned completed sessions, independent NIFTY 500 price-index identity, missing sector/tradability/bands and stale sources. Per-listing surveillance imports and live G06 enforcement are implemented; broader registry and benchmark source adapters remain under KAN-44/45. Legal approval, account authentication and source rights are never inferred from this registry.

Verification: unit identity/chronology/ambiguity tests; PostgreSQL immutable snapshot and overlap-constraint tests; scan-universe pin/retry; persisted sector lookup; authenticated readiness API, proof expiry and invalid PASS rejection. All fixtures are synthetic in the isolated test database.

## Registry inspection and revocation

`GET /api/v1/sources/registry?dataset=DAILY_CANDLES` requires an owner session and returns the latest metadata per dataset/provider/endpoint with independent DOWNLOAD, STORE, DERIVE, DISPLAY and REDISTRIBUTE decisions. An absent dataset is UNKNOWN; an expired or invalid record cannot become PASS. This endpoint reports permission metadata, not licensed market content. A recorded entry is not itself a readiness approval.

With DATABASE_URL configured, `node scripts/source-registry.mjs import <reviewed-metadata.json>` saves immutable SourceRecord metadata; `node scripts/source-registry.mjs view [dataset]` inspects it. Permission values must be boolean or null. Denials can be recorded without permission to store the dataset itself. Actual acquisition adapters must require a current passing decision before obtaining or persisting that dataset.

Backfill bindings now require the currently known source revision before a provider request and again before returning fetched candles for persistence. A changed source revision fails the window with BACKFILL_SOURCE_SUPERSEDED, including revocation during an in-flight request. A later revision never falls back to an earlier passing grant. Historical asOf queries still return only evidence known at that time.

KAN-44 remains In Progress pending enforcement across remaining derived-data consumers. G07 source binding is implemented below. Run `node scripts/database-command.mjs test source-registry download-preview` for isolated registry, API, revocation and download regression tests.

## G07 source bindings

A passing G07 proof must include `details.sourceBindings`: exactly one `{role, sourceSnapshotId}` entry for each of INSTRUMENT_MASTER, UNIVERSE, CALENDAR, DAILY_CANDLES, LIVE_QUOTES, CORPORATE_ACTIONS, BENCHMARK, SECTORS and SURVEILLANCE. Each source record's dataset must equal its role. Snapshot IDs must be distinct and reference the latest known revision for that dataset/provider/endpoint. All roles require STORE, DERIVE and DISPLAY; DAILY_CANDLES and LIVE_QUOTES also require DOWNLOAD. No public redistribution permission is inferred or required for private use.

Submit a reviewed proof through `node scripts/source-registry.mjs proof <reviewed-g07.json>`. It uses the existing GateProof fields: gate, status, probeAt, sourceAt, expiresAt, sourceReference, reason and details. This records supplied evidence; it does not perform legal review or grant rights. Invalid, missing, denied, expired or superseded source bindings cannot be saved as PASS. Legacy unbound PASS records read as UNKNOWN.

Every readiness read reevaluates the bindings. The effective proof deadline is capped by the earliest source expiry or freshness deadline; storedLicenseProof preserves the original immutable proof. A new source revision requires a new reviewed proof, even if its permissions are still affirmative. Revocation immediately blocks subsequent readiness-dependent BUY/broker actions.

## Inspector and correction replay

The chart inspector requires current DISPLAY and DERIVE permission for the actual raw candle revisions behind its saved structure. Missing lineage, denied or expired rights, and ambiguous source scopes return HTTP 403 without chart values. Indicator, relative-strength and structure replay require current DERIVE and STORE permission, including when returning previously computed results. Relative-strength and structure checks include benchmark and peer candles. Permissions are checked again before saving newly computed results; changed authority aborts the operation.

These checks use the current time independently of the historical market-data cutoff. An old replay date cannot bypass a current revocation. Legacy candle lineage identifies its provider rather than a source snapshot, so multiple endpoints or conflicting records with the same latest timestamp are treated as ambiguous. Supply reviewed DAILY_CANDLES metadata for the actual provider; do not use the synthetic test grants in production.

Run `node scripts/database-command.mjs test data-permissions inspector indicator-replay rs-replay` against the isolated test database for lineage, expiry, revocation, HTTP filtering and replay regression coverage. The standalone daily-structure API also requires current DISPLAY and DERIVE permission before returning its saved evidence.

## EOD scans and research

The shared finalized-series loader requires current DERIVE and STORE rights for calculations that persist results. IPO and SME research request DERIVE and DISPLAY instead; unavailable authority leaves their candle-derived observations UNKNOWN. Position trails retain their existing UNKNOWN fallback when the finalized series cannot be used.

EOD planning omits unavailable input series. Saved plans and worker execution revalidate all contributing stock and benchmark revisions, including when a checkpoint already exists. A revoked benchmark therefore prevents reuse of its saved relative-strength calculations. Planning checks authority before saving, and workers check again before saving checkpoints. Run `node scripts/database-command.mjs test eod-scan position-trail ipo-research sme-research inspector` for these paths.

Saved-scan API responses, candidate pages, latest-scan summaries, data-gap summaries and scan-job progress now require DISPLAY and DERIVE permission for every contributor in the original EOD plan. Missing original plan lineage blocks display rather than substituting today's universe. Revocation returns HTTP 403 without saved prices or candidate rows. Internal immutable scan evidence remains available to processing and audit code.

BUY/PRICE_ONLY market signal lists and `/portfolio/signals` now verify current DISPLAY and DERIVE permissions for the event candles, originating daily execution and previous frozen-pattern execution. They withhold unauthorized records while retaining authorized ones. Responses include `unavailable` entries containing only event ID and reason, plus KNOWN, PARTIAL or BLOCKED_DATA state. Missing original lineage cannot fall back to an older signal revision. The BUY screen explains withheld records rather than treating them as absent events.

Owner-plan lists and candidate-plan summaries nested in portfolio responses also recheck the original signal's candle and frozen-pattern permissions. Denied plans are withheld with ID/reason metadata and explicit state. Plan creation and idempotent retry endpoints check before processing and again before returning evidence; denied display returns HTTP 403. Internal audit history remains stored. These checks address the signal-derived portion of plan evidence; live-quote checks are described below.

Saved plan quotes now require current LIVE_QUOTES DISPLAY and DERIVE permission for their actual provider. Their embedded valuation snapshot is checked separately, including when the plan itself has no entry quote. Missing provider lineage and ambiguous endpoint scopes block display. Quote-bearing portfolio risk snapshots are checked before `/portfolio` and `/portfolio/risk` return; cash-only snapshots do not require unrelated live-price authority. Revocation hides affected plans and returns HTTP 403 for affected valuation or plan POST responses. These checks do not substitute candle grants for live-quote grants.

Dashboard, position-card and position-detail API responses now apply the same live-provider check to the exact valuation snapshot used to build their response. Cards and details expose `riskSnapshotId` for that lineage. Dashboard completed-scan and progress summaries separately check their original EOD plan contributors. Missing candle lineage in legacy adjustment snapshots produces a permission error rather than an unhandled failure.

Stop, card, detail and timeline API responses also verify the raw candles behind original stop structures and saved trailing-stop adjustments. Checks include historical episodes, conservatively blocking the response if any relevant stop history lacks permission or lineage. Displayed card EMAs and detail pivots verify their originating daily executions separately. Revocation returns HTTP 403 without stop or timeline payloads; the journal and immutable audit records remain unchanged.

Position status and both SELL-list APIs now apply the history permission check. Protective/partial-profit quotes and quote-derived status history require current LIVE_QUOTES rights for their recorded providers; breakout-failure and status adjustment references require their archived candles. New protective signals retain quote evidence, and new status records retain `quoteProvider`. Legacy quote-bearing records without provider lineage are blocked rather than attributed to a current mapping. The same checks protect stop/card/detail/timeline responses that expose this history.

Backtest result, instrument and comparison reads require current DAILY_CANDLES DISPLAY/DERIVE rights for the providers in their immutable raw archive. Run metadata remains accessible without price payloads. Historical snapshot creation and chronological replay persistence separately require STORE/DERIVE, before work and again inside their transaction; retries also recheck authority. An old market cutoff is never used as the permission-check time. Cash-only archives with no raw candles do not require unrelated candle grants.

Dashboard and portfolio risk responses also verify owner stop/status history and the original scan behind their regime evidence. Saved plans check their original regime scan independently of their signal and quote permissions. Plan lists withhold denied records; plan creation and retries return HTTP 403 when source evidence cannot be displayed. Tests independently revoke benchmark, initial-stop, trailing-stop and historical quote rights while verifying that actual holdings remain unchanged. The EOD acceptance fixture uses its own migrated schema within `vcp_test` so unrelated historical owner records cannot affect it.

KAN-44 remains In Progress: corporate-action/reference-data lineage, other storage consumers and write-time revocation races still need review. This is not a completed licensing rollout.
