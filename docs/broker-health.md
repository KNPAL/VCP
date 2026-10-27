# Broker health surfaces — KAN-143 Coded

The header, Settings > Broker Connections, Universe & Data and historical download form share a status context. It reads the owner-only status API every five seconds with a four-second timeout; failed requests clear readiness immediately. Responses older than twelve seconds stop showing readiness. Session, static-IP and live-proof expiry are also checked locally every second, independent of polling.

Connection changes publish an in-memory refresh event without credentials, forcing the shared state and data screens to reload without a full page reload. The connection page also reconciles saved configuration periodically. App event delivery remains separate from Angel One authentication. A lost event socket or a stale-quote event suppresses STREAM_READY and displays MONITOR_DEGRADED. A verified fresh quote or recovered delivery can restore the delivery gate, but only current server capability proof can permit STREAM_READY.

New download submission is disabled when broker history capability is unavailable. Local coverage preview and stored chart/research navigation remain available. Reconnect links lead to the existing secure PIN/TOTP form; credentials are never reused or placed in browser storage. Broker disconnect retains the app session, history and fills.

Six browser suites passed, covering reconnect, local expiry, provider 403, lost event delivery, configuration errors, download gating, responsive layout and stored-data access through broker failure. Web build and lint passed. This workspace code has not been deployed. Live provider credentials and production connectivity are not inferred from synthetic tests.
