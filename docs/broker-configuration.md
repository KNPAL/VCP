# Broker configuration — KAN-140 In Progress

The workspace supports encrypted owner configuration and a masked status projection. Interactive PIN/TOTP login, complete live-readiness reporting and connection-screen integration remain unfinished; configuration alone does not establish a broker session. No provider login or order request is made by configuration saves.

## Deployment prerequisites

Migration 60 is applied to **vcp_test only**. The deployed application database remains at migration 55. Build the database and API packages and apply all pending migrations through the normal deployment workflow before using the new code.

Create a dedicated 32-byte key in a protected directory whose parent already exists:

```powershell
node scripts/create-broker-configuration-key.mjs .runtime/broker-configuration.key
$env:VCP_BROKER_CONFIGURATION_KEY_FILE='D:\Codex\VCP\.runtime\broker-configuration.key'
```

The command refuses to overwrite an existing file and never prints the key. Restrict the Windows ACL to the API service account. Keep this key separate from preview signing and session encryption keys. Retain it across restarts and use the same file content on every API instance. Replacing it without a planned re-encryption migration makes existing configuration unreadable; automatic rotation is not implemented.

Serve the configuration endpoint over HTTPS. When TLS terminates at a reverse proxy, set `VCP_TRUSTED_PROXY_IPS` to its exact IP addresses, comma-separated. The default trusts no forwarded protocol header. Do not list untrusted clients or expose the backend through a proxy that preserves arbitrary client-supplied `X-Forwarded-Proto`; the trusted proxy must set this header from its actual incoming TLS connection. The API rejects non-IP entries and plaintext configuration writes. Existing deployment files have not yet been updated with this feature's key mount or proxy allowlist.

## API and storage

`PUT /api/v1/broker/angel-one/config` accepts exactly `{apiKey,clientCode}`, an authenticated owner session, CSRF and `Idempotency-Key`. It returns only the accepted revision and reuse indicator. Input validation rejects secret-field extras such as PIN/TOTP. Client codes are normalized to uppercase. API keys and full client codes are encrypted together using AES-256-GCM with owner/revision authenticated binding; only fully masked API key and partially masked client code are readable publicly.

Same-input saves reuse the current revision. A repeated receipt returns its original accepted revision even after a later configuration change; it does not restore old settings. Reusing the receipt for different input returns 409. Changes atomically revoke the previously configured account's circuit and append an immutable audit event. A newly supplied account is not treated as authenticated and does not revoke an unrelated account merely because its client code was entered. Stored candles and portfolio journal entries are untouched.

`GET /api/v1/broker/angel-one/status` adds masked configuration, revision, provider, sessionState and capability fields to existing health metadata. A session must have been verified after the saved configuration to qualify as CONNECTED. First save and replacement require login. Live readiness remains false pending the KAN-141/143 integration; no false live-monitoring guarantee is made. Existing operator-configured account health remains available when no owner configuration exists.

Remaining work includes owner-configured-account propagation through downloads/streaming, complete session/static-IP/live capability state transitions, interactive login/logout, safe subscription invalidation verification and deployment. KAN-140 remains In Progress.

## Verification

`node --test tests/broker-configuration.test.mjs` checks owner/revision binding, tampering, wrong keys and strict secret input validation. After package builds, `node scripts/database-command.mjs test broker-configuration data-health` uses synthetic secrets and vcp_test to check concurrent/idempotent saves, immutable audit evidence, encrypted storage, masked reads, old-session revocation, retained data, anonymous/CSRF/HTTP rejection, trusted-proxy handling and secret-free request logs. No live credentials are required.
