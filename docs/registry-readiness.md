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

KAN-44 remains In Progress pending explicit G07 binding to all required source revisions and enforcement across remaining derived-data consumers. Run `node scripts/database-command.mjs test source-registry download-preview` for isolated registry, API, revocation and download regression tests.

## G07 source bindings

A passing G07 proof must include `details.sourceBindings`: exactly one `{role, sourceSnapshotId}` entry for each of INSTRUMENT_MASTER, UNIVERSE, CALENDAR, DAILY_CANDLES, LIVE_QUOTES, CORPORATE_ACTIONS, BENCHMARK, SECTORS and SURVEILLANCE. Each source record's dataset must equal its role. Snapshot IDs must be distinct and reference the latest known revision for that dataset/provider/endpoint. All roles require STORE, DERIVE and DISPLAY; DAILY_CANDLES and LIVE_QUOTES also require DOWNLOAD. No public redistribution permission is inferred or required for private use.

Submit a reviewed proof through `node scripts/source-registry.mjs proof <reviewed-g07.json>`. It uses the existing GateProof fields: gate, status, probeAt, sourceAt, expiresAt, sourceReference, reason and details. This records supplied evidence; it does not perform legal review or grant rights. Invalid, missing, denied, expired or superseded source bindings cannot be saved as PASS. Legacy unbound PASS records read as UNKNOWN.

Every readiness read reevaluates the bindings. The effective proof deadline is capped by the earliest source expiry or freshness deadline; storedLicenseProof preserves the original immutable proof. A new source revision requires a new reviewed proof, even if its permissions are still affirmative. Revocation immediately blocks subsequent readiness-dependent BUY/broker actions. Standalone derived-data reads and replay enforcement remain under KAN-44; do not treat this as completed licensing rollout.
