# SELL alerts

Open **SELL** at `/sell`. The authenticated API `/api/v1/positions/sell-alerts` projects the owner's actual open positions and applies the existing backend precedence: protective, breakout failure, EMA close, partial profit. Each position has one primary alert; lower-priority evidence remains in position detail. Resolved signals and closed episodes do not create pending sales.

The screen shows remaining actual quantity, source LTP/finalized close and timestamp, recognition and effective times, source revision, active stop, monitoring state and acknowledgement. An old source price is historical evidence, not a fresh quote. Missing or expired monitor evidence displays `MONITOR_DEGRADED`; expired projection quantities/stops display `UNKNOWN` until refreshed.

Acknowledgement records review only. It does not resolve an alert, change holdings or send an order. A partial-profit suggestion can be dismissed with a reason; full exits take precedence and are not dismissible here. Use the position-detail link to record an already executed manual sale.

The screen refreshes every five seconds and rejects superseded responses. Failure states clear the displayed projection. Source revisions and raw ages remain visible; the browser does not recompute VCP or exit priority.

Verification uses the existing partial-profit integration suite and `VCP_SELL_ALERTS_TEST=true` with the isolated browser harness. Browser acknowledgements/dismissals are intercepted; synthetic financial records are confined to `vcp_test`.

On a busy local host, set WEB_TEST_STARTUP_TIMEOUT_MS=120000 for the browser harness (default 30000; maximum 180000). Each readiness probe has a two-second timeout. This changes test startup allowance only.
