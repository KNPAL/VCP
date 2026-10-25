# VCP chart inspector

KAN-120: open `/inspector` or select **Inspect latest execution** from a screener row. Choose a stored daily execution; `?execution=<id>` pins an older immutable execution and `?listing=<uuid>` selects the latest available one for a listing.

Authenticated endpoints:

- `GET /api/v1/vcp/inspector`: latest stored execution per listing.
- `GET /api/v1/vcp/inspector/:id`: adjusted candles and volume, production SMA50/150/200 and EMA21 curves, stored confirmed swings/legs/pivots, market events, and owner-scoped actual fills/stop history.

The chart initially shows the latest 90 bars; Fit chart reveals up to 260 display bars. Server indicator calculations use the full pinned warmup history. No VCP detection runs in the browser. Solid swing segments come directly from the stored detector. The dashed tail is the subsequent close-price path, explicitly not a confirmed swing. T1/T2 and later legs reference the selected primary pattern; all patterns are inspectable below. Occurrence and confirmation timestamps remain separate. A breakout's previous frozen pivot is distinguished from the selected session's frozen pivot.

Actual-fill markers indicate dates only, with raw execution prices in the evidence section. Reversed fills are removed. Corporate-action basis mismatches and replaced entry fills prevent stop overlays. Stops/trails end at the actual episode closure, and no future effective stop is projected past the chart's last session. Actual journal history is read at request time while market structure remains pinned. The page cannot place orders or alter the journal.

Warmup gaps are UNKNOWN. Loading, no stored execution, empty candle set, stale source, 401/403/404/503, and chart-render failures have distinct displays. Evidence tables provide keyboard-accessible equivalents to the canvas, including exact decimal values and IST timestamps. Chart navigation has native keyboard buttons.

Uses TradingView Lightweight Charts 5.0.9 under Apache-2.0, with visible TradingView attribution and link. See the package's LICENSE and the upstream version's NOTICE.

Verification:

```sh
node --test tests/inspector.test.mjs
node scripts/database-command.mjs test inspector
```

For the isolated browser runner, set `WEB_TEST_PORT=3002`, `VCP_INSPECTOR_TEST=true`, `VCP_BROWSER_CHANNEL=msedge` and `VCP_PLAYWRIGHT_MODULE` to the Playwright module URL, then run `node scripts/database-command.mjs test-web`. On Windows use a `file:///C:/.../index.mjs` module URL. Financial browser responses are intercepted fixtures; PostgreSQL fixtures are restricted to `vcp_test`.
