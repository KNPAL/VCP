# Instrument-master import

KAN-41 imports an already acquired SmartAPI JSON master with independently reviewed company/listing mappings. Provider field names follow the [SmartAPI instrument documentation](https://smartapi.angelone.in/docs). This command does not download data or infer permission to use it.

Apply migration 63, build market-data and database, and provide DATABASE_URL as described in the root README. Run:

```powershell
node scripts/instrument-master.mjs import <reviewed-master-envelope.json>
```

The JSON envelope has `source`, `knownAt`, `tickDivisor`, `mappings` and `records`:

- `source` follows SourceRecord: dataset/provider/file, license reference, explicit permitted uses, knowledge/effective/source/verification timestamps, expiry, maximum age, adjustment policy and coverage. STORE and DERIVE must both be explicitly permitted and current. No source payload is saved when either check fails.
- `records` contains the provider's full JSON array. The adapter reads token, symbol, exch_seg, instrumenttype, expiry, tick_size and lotsize. Decimal values must be strings.
- `mappings` contains reviewed InstrumentMapping records: stable company/listing UUIDs, ISIN, exchange, series, symbol, instrument type, tick in rupees, integer lot, listing/effective dates, provider/token and explicit verified/enabled flags. The provider master alone cannot establish ISIN or distinguish every ETF from equity. Missing or ambiguous review records never become actionable mappings.
- `tickDivisor` is an explicitly reviewed unit conversion, either `"1"` or `"100"`. The converted raw tick must equal the reviewed tick exactly; the importer never chooses a conversion automatically.

NSE/nse_cm and BSE/bse_cm are recognized. Other segments and provider derivative/index types are excluded. Only independently verified NSE EQ or BSE CASH equity enters the normalized snapshot. Tokens normalize as positive integer strings; symbol, lot, tick and empty expiry must match the reviewed identity. Duplicate exchange/token rows quarantine every copy. Failed rows retain their input index and reason in the import report, without publishing the rejected mapping.

Each import atomically saves a complete normalized snapshot and an immutable InstrumentMasterImport audit report containing source metadata, content hash, tick conversion, row outcomes and counts. A PARTIAL result exits with code 2 and must be reviewed; it is not an all-success result. Even an empty accepted set publishes an empty snapshot, preventing rejected current mappings from silently falling back to an older master. The existing source-aware calendar, broker and readiness gates still apply before entry eligibility.

Identical permitted retries return the original report, including after process restart. Retrying an expired source does not refresh its authority. Obtain reviewed current source evidence and submit a new import. The source hash connects the normalized snapshot to its audit report. No financial fills, broker orders or synthetic production market data are created.

Verification uses only synthetic fixtures in vcp_test:

```powershell
node --test tests/instrument-master.test.mjs tests/instruments.test.mjs
node scripts/database-command.mjs test instrument-master
```
