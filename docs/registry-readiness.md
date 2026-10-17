# Instrument identity and external readiness

Companies use stable UUID/ISIN identity; exchange listings have independent UUIDs. Provider tokens and symbols belong to effective-dated mapping versions. Full normalized master snapshots are immutable, source-referenced and knowledge-dated. Mapping validity is half-open [from,to), and PostgreSQL excludes overlapping ranges for a listing/provider within a snapshot. Identity conflicts fail rather than replacing an existing company or listing.

Canonical selection prefers one verified enabled NSE EQ equity listing, then one verified enabled BSE cash equity listing. Ambiguity, unsupported ETFs/indexes/derivatives, missing mapping or unverified source gives UNKNOWN with reasons. Other exchange mappings remain available for research. Raw provider-master parsing and broker acquisition (KAN-41) remain unfinished; current import accepts the typed normalized contract only.

NIFTY 500 universe snapshots retain effective and knowledge dates and source references. Each scan pins immutable universe membership and canonical mappings. Missing historical constituent verification explicitly labels SURVIVORSHIP_BIASED_RESEARCH. Sector snapshots retain per-ISIN effective ranges and source references, reject overlap, and return UNKNOWN for missing current mapping.

GET /api/v1/sources/readiness returns all G01–G10 statuses, source/probe timestamps, expiry, proof, allowed/blocked capabilities and exact failure policy. Missing proof is UNKNOWN; expired passing proof cannot remain PASS. The application database contains no artificial passing proofs. A source registry separately records permitted download/storage/derivation/display/redistribution, license references, freshness and coverage.

Benchmark and surveillance validators have fixtures for 252 aligned completed sessions, independent NIFTY 500 price-index identity, missing sector/tradability/bands and stale sources. Their actual external-source adapters and enforcement in live plans remain unfinished (KAN-44/45/47). Legal approval, account authentication and source rights are never inferred from this registry.

Verification: unit identity/chronology/ambiguity tests; PostgreSQL immutable snapshot and overlap-constraint tests; scan-universe pin/retry; persisted sector lookup; authenticated readiness API, proof expiry and invalid PASS rejection. All fixtures are synthetic in the isolated test database.
