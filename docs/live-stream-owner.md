# SmartAPI stream owner (KAN-105)

The worker has one account-scoped coordinator. Its Redis owner name is `smartapi-<accountKey>`, derived from the verified account rather than a per-process identifier. A 15-second lease and increasing fence guard connections and cached writes. A second worker cannot subscribe while that lease is held. Each reconnect acquires a new fence; old callbacks and cached quotes cannot become current. The three-second loop is separate from EOD work. Missing pong for 20 seconds, a failed lease renewal, credential changes, session changes, or a connection error closes the socket. Reconnect backoff grows from one to 60 seconds; renewed credentials are resolved before connecting. A process suspended beyond its lease cannot publish when resumed; broker-side disconnect detection may lag lease expiry, but only the current fence can produce usable quotes.

Subscriptions are rebuilt from actual open holdings, then fresh READY candidates and nearest WATCH candidates. The default cap is 100 (configurable 1–1000). Holdings take priority. Candidate proximity uses exact cross multiplication. Verified canonical ANGEL_ONE cash-equity mappings supply tokens; missing, expired and ambiguous tokens are excluded. Desired-state differences unsubscribe removed tokens before adding new ones. Candidate subscriptions require a scan for the latest finalized session and verified calendar coverage through today. There is no whole-market subscription.

The transport uses the fixed SmartAPI V2 endpoint, verified TLS, no redirects, an eight-second handshake deadline and a bounded payload. It supports only LTP cash-equity binary frames and retains int64 sequence/price values without floating-point conversion. Its protocol follows the official [Angel One WebSocket implementation](https://github.com/angel-one/smartapi-python/blob/main/SmartApi/smartWebSocketV2.py). All accepted ticks still pass the KAN-106 mapping/session/freshness boundary. No order endpoint is used.

## Configuration

Provision authentication using [broker-credentials.md](broker-credentials.md). A new successful login retains the returned feed token and verified client code in the existing encrypted credential envelope. Older credentials without feed fields remain valid for historical requests but require reauthentication for live streaming. PIN and TOTP remain unpersisted. Returned refresh tokens are retained only inside the encrypted session envelope and never extend its expiry. The owner re-reads the current circuit/session on every cycle; revoked, expired or unavailable credentials stop monitoring.

The worker resolves the saved owner account on every coordinator cycle. Changes close the previous stream before replacement; revocation or routing failure stops monitoring. Browser quote delivery and position monitoring also honor saved owner configuration. Set these variables on the worker process:

```text
VCP_ENABLE_LIVE_STREAM=true
VCP_STREAM_ACCOUNT_KEY=<optional legacy accountKey when no owner configuration exists>
VCP_STREAM_CAPACITY=100
BROKER_KEY_DIRECTORY=<directory containing the encryption key files>
```

Do not put feed tokens or passwords in environment variables, queue jobs or source control. For Docker, supply a private Compose override that sets these worker variables and mounts the key directory read-only at the configured container path. For local development, set the variables before `node scripts/local-server.mjs worker`. Streaming defaults to disabled. A valid broker account, current verified instrument/calendar data and any required market-data permissions must be provisioned by the operator; local tests do not establish live connectivity.

## Verification

Build market-data, database and worker first. Run `pnpm test` for protocol, subscription priority, encrypted credentials and transport failure checks. Run `node --test tests/stream-owner.integration.mjs tests/live-quotes.integration.mjs` with local Redis on 56379 for lease contention, replacement ownership, callback fencing and replay rejection. These tests use synthetic frames and unique Redis namespaces, not the broker. The application database receives no synthetic trades.
