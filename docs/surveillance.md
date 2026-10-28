# Surveillance and tradability (KAN-47, Coded)

G06 is evaluated per canonical listing. It requires explicit ASM, GSM, ESM, cash-tradability and lower/upper price-band evidence. Missing flags are UNKNOWN; a known restriction blocks entry. An expired or changed mapping, stale source, missing source rights or denied permission cannot produce PASS. A project-wide readiness proof never substitutes for these instrument facts.

Migration 62 adds immutable `SurveillanceSnapshot` records. Import a reviewed, licensed publisher export normalized to `SurveillanceEvidence` using the operator-only command below. Use the root README's protected DATABASE_URL setup; no database password belongs in the command or input file.

```powershell
node scripts/surveillance.mjs import path/to/reviewed-surveillance.json
node scripts/surveillance.mjs view <listing-uuid>
```

The JSON object contains `listingId`, `mappingRevision` (the current instrument snapshot ID), `source` (the full SourceRecord contract) and `restrictions`. Restrictions contain boolean `verified`; UTC `knownAt`, `sourceAt`, `validUntil`; nullable boolean `asm`, `gsm`, `esm`, `cashTradable`; and nullable exact decimal strings `lowerBand`, `upperBand`. Use null when a source does not establish a fact. A source record includes dataset/provider/file identity, license reference, explicit STORE/DERIVE/DISPLAY permissions, known/effective/source/verification/expiry timestamps, maximum source age, update frequency, adjustment policy, coverage and any error. STORE permission is required to import; DERIVE and DISPLAY permission are required to use and show the result.

The importer verifies canonical listing identity at the evidence timestamp, rejects malformed flags and contradictory timestamps, and deduplicates identical input by content hash. Corrections create new records. The latest known record is authoritative, including UNKNOWN or restricted observations; reads do not fall back to an older PASS. No feed values are invented and no publisher is automatically contacted by this adapter. Production requires a licensed, reviewed source and regular imports before expiry.

Authenticated `GET /api/v1/sources/surveillance/{listingId}` returns status, reasons, revision, expiry and price bands only when source permissions and mapping allow them. Entry evaluation consumes this result, checks the observed price against the bands, bounds plan lifetime by surveillance expiry, and invalidates older plans when evidence changes. G06 PASS alone never grants BUY permission or creates a fill.

Run `node scripts/database-command.mjs test surveillance entry-risk` against the isolated test database. Tests cover missing/expired/restricted evidence, malformed flags, denied storage/derivation, chronology, mapping corrections, immutable records, duplicate imports, G06 plan propagation and saved-plan invalidation. Migration 62 has only been applied to `vcp_test`; deployed `vcp` remains at migration 55.
