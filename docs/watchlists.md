# Saved watchlists (KAN-79)

Open **My watchlists** in the authenticated sidebar. Create a named list, choose a verified canonical cash-equity instrument and add it. The table shows saved timestamps in IST and explicit UNKNOWN research status while verified scan/quote evidence is unavailable. Removing a saved instrument does not remove the underlying listing or alter patterns, indicators, fills, signals or eligibility.

Filter by symbol/ISIN text and exchange, then select **Save filters**. Filters persist on the server with the list. Selecting that list again restores them. Saving an existing name replaces its filters; list names are scoped to the authenticated owner. An empty instrument selector means verified mapping data must be imported first; the UI does not invent examples.

## API

All routes use session authentication. Mutations also require the existing same-origin and X-CSRF-Token checks. Requests reject unknown properties.

- `GET /api/v1/watchlists`: caller-owned lists with filters, timestamps, saved items, null quote and explicit research reason.
- `POST /api/v1/watchlists`: `{name, filters: {query, exchange}}`; name 1–80 characters, query at most 80, exchange ALL/NSE/BSE. Creates a list or saves filters on the same owner/name.
- `GET /api/v1/watchlists/instruments`: eligible canonical cash-equity listings from the latest known instrument snapshot; NSE EQ preferred to BSE CASH per ISIN. Missing/ambiguous mappings are not offered.
- `POST /api/v1/watchlists/{id}/items`: `{listingId}`. Validates current canonical mapping before adding.
- `DELETE /api/v1/watchlists/{id}/items/{listingId}`: idempotent item removal.

Duplicate saves/adds/removals do not duplicate items or audit events. A per-owner database lock serializes concurrent edits. WatchlistAudit stores each effective mutation with its inputs, configuration SHA256 and timestamp; updates/deletes of audit entries are rejected. Foreign-owner list IDs return WATCHLIST_NOT_FOUND. Invalid input/canonical listing returns 422; malformed request fields return 400.

Migration 26 adds Watchlist, WatchlistItem and immutable WatchlistAudit. Follow the root README's normal migration and build steps. No broker calls or order placement occur, and a saved item is never a BUY signal. The existing entry evaluator remains responsible for stale quotes, completed-session timing, chase and stop limits.

The UI distinguishes access denied (403) from service unavailable (503), retains previously loaded lists with a stale-data warning, and provides Retry. Saved timestamps include raw source age alongside IST. Instrument, list and exchange controls have explicit accessible labels. Run the focused browser checks with VCP_WATCHLIST_TEST=true using the root README browser-test setup.
