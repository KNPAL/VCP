# NSE cash-equity holidays, 2015–2026

The VCP database contains the named holidays from all twelve NSE Capital Market annual circulars, plus verified amendments, reviewed on 8 November 2026. The checked-in dataset is `data/nse-cm-holidays-2015-2026.json`. Each record retains its source references; each source has its official NSE PDF URL, publication date and SHA-256 checksum.

There are **231 unique dates: 219 closed holiday observances and 12 Muhurat session dates**. Counts include holidays falling on weekends; they are not counts of lost weekday trading sessions. Ordinary Saturdays and Sundays are not enumerated.

| Year | Records, including Muhurat |
| --- | ---: |
| 2015 | 19 |
| 2016 | 19 |
| 2017 | 18 |
| 2018 | 19 |
| 2019 | 21 |
| 2020 | 19 |
| 2021 | 19 |
| 2022 | 18 |
| 2023 | 19 |
| 2024 | 22 |
| 2025 | 18 |
| 2026 | 20 |

Amendments include 29 April and 21 October 2019; 22 January, 20 May and 20 November 2024; and 15 January 2026. The 2023 Bakri Id closure is **29 June**, superseding the annual circular's 28 June date. The unavailable original 2023 and January 2024 amendment PDFs are corroborated by official NSE notices CMPT57296 and SURV60342, which explicitly reference the original CMTR circulars. This distinction is recorded in the source metadata.

## Import or inspect

From the repository root, with the normal local VCP PostgreSQL service running and dependencies installed:

```powershell
node scripts/database-command.mjs migrate
node scripts/import-nse-holidays.mjs
node scripts/import-nse-holidays.mjs --apply
node scripts/import-nse-holidays.mjs --report
```

The command without flags validates the dataset without accessing PostgreSQL. `--apply` imports into the local `vcp` database on port 55432 using `.runtime/database-password`; it never accesses the Swing database. The import is atomic and repeatable. Existing identical records are retained, while conflicting records cause a rollback and require review. `--report` reads the stored yearly totals without writing.

The table is `ExchangeHoliday`, keyed by exchange, segment and date. For example:

```sql
SELECT "date", "name", "kind", "weekend", "evidence"
FROM "ExchangeHoliday"
WHERE "exchange" = 'NSE' AND "segment" = 'CM'
ORDER BY "date";
```

## What this initializes

This imports **holiday facts**, not a full daily trading-session calendar. Muhurat dates use `MUHURAT_SESSION`; their hours have not been imported. They must never be treated as full-day closures. The absence of a date does not prove that it was an ordinary trading day: special Saturday sessions and other session amendments require separate evidence.

The operational `CalendarSnapshot` is deliberately separate and is not populated by this command. The [Data setup screen](market-data-setup.md) now builds the supported 2025–2026 daily calendar using these holidays and verified special-session notices. The holiday import does not mark market-data initialization complete, create stock/token mappings or NIFTY 500 membership, approve market-data permissions, or submit historical downloads. These holiday facts are available for the subsequent session-calendar initialization. Future NSE amendments after the review date require a reviewed dataset update.
