# Scanner contracts

KAN-74/75/77: shared strategy functions compute scan coverage, exact ranking and cursor pages. The database stores final scan evidence append-only and rejects an existing scan ID with changed contents. A new data correction requires a new scan ID. The complete intended listing set must be provided; omitted outcomes become MISSING/NOT_PROCESSED, never successful. COMPLETE means all intended listings were analyzed or explicitly excluded. PARTIAL has analyzed and missing listings; ERROR has missing listings and no analyzed results.

Ranking uses market state, RS descending (unknown last), legs descending, final depth ascending, VDU ascending (unknown last), max(0,(pivot-close)/pivot) ascending, median raw turnover descending, then instrument UUID. Proximity comparisons use integer cross multiplication, never rounded percentages. Every result carries scanId, asOf, configuration hash, data revision, reasons and the exact tuple. Ranking is not success probability.

Authenticated reads:

- GET /api/v1/system/scans/{id}: immutable coverage and results.
- GET /api/v1/system/data-gaps: latest missing/excluded listings with reasons; NO_COMPLETED_SCAN before any scan exists.
- GET /api/v1/vcp/candidates?scanId={id}&state=READY&sort=rank&limit=50: rank-stable page, with nextCursor/asOf/dataRevision. scanId is mandatory. Cursors are bound to scan, configuration, revision and filter; using them with another scan or filter returns 400. Limit 1–200. Unknown state names return 400 instead of an empty page.

Coverage and ranking are deterministic under input permutations. PostgreSQL/API integration tests verify persisted partial results, duplicate retry, immutable conflict, protected endpoints and invalid cursors. Unit tests cover every rank tie-break, missing inputs, ratio precision and page stability.

Whole-universe scheduling/checkpoints (KAN-73), enriched nested-pattern metadata and references (KAN-76), alerts (KAN-78), and actual finalized-data acquisition remain separate unfinished work. Candidate DTO also includes the primary and nested pattern IDs and complete persisted contraction/chart metadata, verified through the authenticated API. Depth values are percentages, matching the VCP engine. No scan is fabricated for the application database.

