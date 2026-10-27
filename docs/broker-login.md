# Broker login lifecycle — KAN-141 In Progress

The owner-only HTTPS login API now orchestrates PIN/TOTP authentication through the broker gateway, verifies the provider profile, and stores encrypted session credentials. Local broker logout is available. Typed remote provider errors, browser form integration and full live acceptance remain unfinished; KAN-141 stays In Progress. No live broker authentication was performed.

Migration **61** is applied to **vcp_test only**. Apply all pending migrations and rebuild database, API and worker packages before deploying this code; the deployed application database still remains at migration 55.

`beginBrokerLogin` requires saved owner configuration, locks against configuration edits, permits one active attempt and limits the owner to five starts in a rolling fifteen-minute window. The limit is persisted in PostgreSQL and is not reset by changing configuration or restarting the API. Attempts expire after sixty seconds. Beginning reauthentication closes the prior account circuit, so old credentials cannot continue serving broker requests while authentication is underway.

The attempt records contain only owner/configuration/account references, state, safe error codes and timestamps. PIN, TOTP and provider response bodies are never accepted by this persistence boundary. Immutable `BrokerLoginEvent` records preserve each accepted state transition.

`completeBrokerLogin` accepts already provider-verified session material from a trusted authentication adapter. It encrypts credentials through the existing session vault. The attempt must still be active, unexpired, owned by the same owner, and bound to the current configuration/account. The check and session installation share one transaction and acquire the configuration lock before circuit writes. A rejected late response leaves no session credential or successful event behind. Configuration changes supersede in-flight attempts atomically.

`failBrokerLogin` accepts only a fixed safe error-code set and cannot overwrite a completed attempt. Public broker status reports AUTHENTICATING only while its current attempt is valid; expired attempts report NEEDS_LOGIN and SESSION_EXPIRED. A failed attempt exposes its safe error code without provider text or secrets. Live readiness remains independently blocked until the remaining integration is complete.

Run `node scripts/database-command.mjs test broker-login broker-configuration download-preview` after package builds. Synthetic tests cover simultaneous starts, wrong-owner failure attempts, configuration changes during login, stale-response rollback, successful encrypted installation, duplicate terminal failure, timeout rejection, persisted rate limits and unchanged download behavior. Test fixtures reset only their own synthetic rolling-window timestamps in vcp_test after verification; production code never resets rate limits.

## API and runtime setup

`POST /api/v1/broker/angel-one/login` accepts exactly `{"pin":"…","totp":"…"}`. PIN is 4–8 digits and TOTP exactly six digits. Send the authenticated app cookie and CSRF header over HTTPS. The response contains broker status metadata only. Returned access, feed and refresh tokens are encrypted in the server vault; refresh does not extend the daily cutoff or bypass re-login. Rate limits persist in PostgreSQL (five starts per fifteen minutes); provider requests share the worker's account-scoped Redis budget. Malformed input returns 422, concurrent login 409, rate limiting 429, and unavailable configuration/static-IP proof/provider 503. Remote rejection currently maps conservatively to PROVIDER_UNAVAILABLE.

The API process needs:

- `VCP_BROKER_CONFIGURATION_KEY_FILE`: existing raw 32-byte configuration key, as described in [broker configuration](broker-configuration.md).
- `BROKER_KEY_DIRECTORY` and `VCP_BROKER_SESSION_KEY_ID`: the existing session-vault key directory and key ID. The file `<key ID>.key` contains base64 text decoding to 32 bytes; this differs from the raw configuration-key format. API and worker must resolve the same session key.
- `VCP_BROKER_NETWORK_FILE`: protected JSON containing exactly `clientLocalIp`, `clientPublicIp`, `macAddress`, and `ipProof`. The proof contains `address`, `verifiedAt`, `expiresAt`, and `sourceReference`. Use actual verified deployment/network values; an expired or mismatched proof blocks login.
- `REDIS_HOST` and `REDIS_PORT`: the same Redis instance used by the worker, so login and ingestion share provider quotas.
- `VCP_TRUSTED_PROXY_IPS`: only the actual reverse proxy IPs when TLS terminates there. Forwarded HTTPS is ignored from untrusted peers.

`POST /api/v1/broker/angel-one/logout` accepts `{}` with the same HTTPS, cookie and CSRF protections. It atomically closes the local broker circuit, supersedes active/completed login attempts and pauses active manual downloads. Repeating logout is safe. An in-flight login cannot install a session after logout. Saved broker configuration, the app session, portfolio records and historical candles are retained. Revocation does not depend on provider availability and does not claim to revoke tokens at Angel One. Existing worker streams recheck credentials during their three-second coordinator cycle and disconnect on revocation; an already dispatched provider request may finish. Broker status reports NEEDS_LOGIN and disables history/live permissions.

Run `node scripts/database-command.mjs test broker-login-api broker-login broker-configuration download-preview` after building database and API. API tests use a synthetic provider and verify profile matching, metadata-only responses, secret-free logs, HTTPS/CSRF checks, logout repeatability and preserved app authentication. Lifecycle tests verify that revoked credentials cannot resolve and late login responses cannot reconnect.
