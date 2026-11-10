# Initialize data and download stocks

Start VCP using the root README, sign in at `http://localhost:3000`, and open **Data setup & downloads** in the sidebar (direct URL: `/data/setup`).

1. Connect Angel One if the connection card says a connection is needed.
2. Confirm your personal-research use and click **Initialize market data**. No agreement number or `.env` edit is required. This is recorded as an owner declaration, not a reviewed license agreement; redistribution stays disabled. General live-trading and research readiness gates remain separate.
3. Wait for the imported count, then inspect any excluded entries. Initialization fetches Angel One's instrument master, NSE's equity list and the official NIFTY 500 constituents. It matches ISIN, symbol, exchange, series, token, listing date, lot and tick size. Current membership is effective from the import date, never backdated for historical constituent research.
4. Click **Download stocks**. Select all eligible stocks or a custom selection. Choose daily candles, dates and **Missing sessions only** (or reconciliation), then click **Preview stored coverage**.
5. Review the counts and click **Start download**. Follow **Download progress** for completion, remaining ranges, errors and retries. The background worker continues if you leave the page.

The supported session calendar currently covers **1 January 2025 through 10 November 2026**. Default dates are clamped to this range. Older imported holiday facts are retained, but do not constitute a complete daily calendar. The next range extension needs the applicable special-session and amendment review. Source snapshots expire after seven days; use **Refresh market data** to refresh stock reference data and personal-use metadata. Do not refresh while an active job is using the previous source revision; jobs pin their source revisions and will require a new preview if these change.

On 10 November 2026, the official constituents file contained 501 entries. VCP imported **495 matched EQ-series stocks**, retaining explicit exclusions for three RR-series REITs, two BE-series stocks and one dummy placeholder. Eligible-stock selection does not include these unsupported entries.

First downloads use completed calendar sessions as expected coverage. They do not claim those candles have already been observed at Angel One. The worker validates actual responses, stores valid candles, and reports missing sessions or quarantined data. The same process supports downloading newly completed sessions after an earlier successful download.

## Calendar sources and daily ingestion semantics

Annual holidays and amendments are documented in [NSE holidays](nse-holidays.md). Normal trading days follow [NSE market timings](https://www.nseindia.com/static/market-data/market-timings). Additional session notices used here:

- [1 February 2025 Budget trading](https://nsearchives.nseindia.com/content/circulars/CMTR65729.pdf)
- [21 October 2025 Muhurat trading](https://nsearchives.nseindia.com/content/circulars/CMTR70319.pdf)
- [1 February 2026 Budget trading](https://nsearchives.nseindia.com/content/circulars/CMTR72349.pdf)
- [8 November 2026 Muhurat trading](https://nsearchives.nseindia.com/content/circulars/CMTR76941.pdf)

The daily ingestion envelope includes post-close and closing-auction activity. It is **not an intraday continuous-trading schedule**. A conservative 16:30 IST boundary is used for daily planning; actual provider response validation still determines what is stored. Future sessions are never included before that boundary.

## Verification performed

- Real official-source import into the independent VCP PostgreSQL database.
- Desktop and 390-pixel mobile setup/download screens, with no horizontal page overflow.
- Real RELIANCE download for 1–9 November 2026: seven candles stored, job completed.
- Unit coverage for CSV handling, ambiguous mappings, special sessions and first-download planning; broker/download integration coverage for ownership, revisions, revocation and worker dispatch.

The light theme uses a green sidebar, filled primary buttons, outlined secondary buttons, underlined links, visible keyboard focus, and distinct disabled controls.
