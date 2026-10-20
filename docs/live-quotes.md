# Live quote boundary (KAN-106)

`normalizeLiveTick` in market-data validates exact provider price units, effective verified cash-equity token mapping, verified exchange session and UTC source/receive/decision times. Unsupported, future, stale, off-tick or unmapped data returns UNKNOWN. Quotes never imply execution.

Worker consumers use `publishLiveTick` and `readLiveQuote`, not raw Redis GET. Acquire the existing stream owner lease first, then record CONNECTED and renew its heartbeat within 30 seconds independently of price changes. Use one stable owner name for the account, shared by all processes. On disconnect or expired heartbeat, release/reacquire the lease before connecting: the new fence invalidates cached quotes, and a new tick must be strictly newer than the prior source timestamp. Old owners cannot publish or renew the connection.

Quote TTL is the smaller of remaining 60-second source freshness and remaining session time. It is never reset from receipt time. Redis TIME determines expiration and heartbeat age. Per-listing two-day replay watermarks survive quote expiry; sequence comparisons preserve integers larger than JavaScript/Lua safe floating-point integers. A connection tombstone retains the last fence and state so an expired heartbeat cannot revive cached data. Redis restart loses transient quotes and returns UNKNOWN until a fresh subscription and tick arrive.

This is the quote boundary for the live stream owner (KAN-105); a broker connection is not claimed. Generated market signals use the PostgreSQL transactional event/outbox boundary documented in alert-outbox.md. The cache does not create SELL signals, fills or orders. Per-position degraded-monitor persistence is KAN-107.

Verification: build market-data then worker; `node --test tests/live-quotes.test.mjs tests/live-quotes.integration.mjs`. Integration uses local Redis port 56379, unique test keys and synthetic calendar/mappings; no financial data is written to the application database.

Cached reads also return validUntil, bounded by the live lease, heartbeat, quote TTL and session close. Consumers must recheck this deadline at the time they decide; KAN-97 does so after acquiring the portfolio lock.
