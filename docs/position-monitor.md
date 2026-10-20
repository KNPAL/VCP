# Held-position monitoring (KAN-107)

Migration 32 adds current per-owner/ISIN feed health and immutable monitoring events. Every worker poll checks actual journal holdings before scanning jobs. Missing calendar, mapping, quote store or stream configuration fails closed. A verified holiday or time outside the exchange session is SESSION_CLOSED, not an outage. FEED_FRESH is only feed health: it never asserts HOLD, evaluates an active stop, changes quantities or creates a fill.

Apply migrations and rebuild using the root README startup steps. The worker runs monitoring automatically. The future/live stream owner and the monitor must share the same stable `VCP_STREAM_OWNER` name. Leave it unset until the stream owner is configured; this produces STREAM_OWNER_UNCONFIGURED during a verified active session. KAN-105 broker subscription transport remains separate work. Do not manufacture quotes or sessions to make the readiness display green.

The quote boundary enforces a current owner fence, connected heartbeat within 30 seconds and source quote within 60 seconds. Monitoring also verifies current listing/token/master revision and exchange session. Redis reads have a bounded wait; failures become degraded evidence. PostgreSQL persists outage opening, recovery and ending with source/decision times and uncovered intervals. An observed worker gap over 15 seconds records a conservative uncovered interval from its last fresh observation. This interval documents unavailable monitoring evidence, not a known exchange outage or an inferred trade.

An outage emits one durable URGENT MONITOR_DEGRADED alert per episode, in the same transaction as its event and current state. Delivery prioritizes SELL first, then degraded held-position alerts, then routine alerts. Repeated degraded polls do not spam notifications. Recovery retains history. An actual closing fill ends the episode with ACTUAL_POSITION_CLOSED; a quote or alert cannot close a position.

GET /api/v1/portfolio includes the authenticated owner's monitor items and latest 100 audit events. Evidence older than 15 seconds, or an expired source quote, reads degraded even if the worker has stopped. The Positions page refreshes monitor health every five seconds, displays affected shares/source times, shows recovery history and fails closed on request errors. Quote health does not unlock BUY eligibility; reconciliation and active-stop/risk work remain separate requirements.

Verification: 137 unit/API tests; monitor, alert and database integration suites; headless Edge outage/recovery/API-failure/mobile check; dependency/API/worker/web builds and lint. Tests use only vcp_test and isolated Redis keys or browser fixtures. Migration 32 is applied to the local application and test databases.

Fresh monitor evidence also carries the quote read's validUntil deadline. Persistence and API reads downgrade expired lease/heartbeat evidence, even when the source quote alone is younger than 60 seconds.
