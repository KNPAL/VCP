# Broker configuration — KAN-140 Coded

The workspace supports encrypted owner configuration and a masked status projection. The internal [login lifecycle](broker-login.md) now tracks attempts and rejects stale responses. Public PIN/TOTP login/logout and the connection screen are implemented. Configuration alone does not establish a broker session. No provider login or order request is made by configuration saves.

## Deployment prerequisites

Migrations 60–61 are applied to **vcp_test only**. The deployed application database remains at migration 55. Build the database and API packages and apply all pending migrations through the normal deployment workflow before using the new code.

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

`GET /api/v1/broker/angel-one/status` adds masked configuration, revision, provider, sessionState and capability fields to existing health metadata. A session must have been verified after the saved configuration to qualify as CONNECTED. First save and replacement require login. Runtime status decrypts configuration and current credentials locally without contacting Angel One. Unreadable configuration reports CONFIG_ERROR/APP_CONFIG_INVALID; unreadable session credentials report UNAVAILABLE. Only a current, matching static-IP proof exposes the server public IP. Missing, changed or expired proof blocks capabilities. Historical capability requires a matching current session and G01/G07; live capability additionally requires feed credentials, VCP_ENABLE_LIVE_STREAM=true on the API, and current G09 heartbeat proof. This is capability/readiness evidence, not a guarantee of quote coverage for every position. The worker must also enable streaming. Status includes staticIpVerifiedAt, staticIpValidUntil and liveValidUntil so screens can expire evidence locally. Existing operator-configured account health remains available when no owner configuration exists.

Download preview and submission now select the owner configuration before the legacy environment account. Signed previews and persisted runs bind its revision. Changing configuration pauses queued/running manual jobs atomically; new claims stop, and explicit retry or a new receipt cannot bypass the revision change. A fresh preview is required. Existing accepted idempotency receipts remain receipts for their original job.

Saved owner configuration now overrides legacy streaming routing. Configuration replacement and logout revoke the old session, stop its coordinator and prevent stale cached quotes from reaching the browser. Deployment remains separate; workspace validation uses synthetic provider data.

## Verification

`node --test tests/broker-configuration.test.mjs` checks owner/revision binding, tampering, wrong keys and strict secret input validation. After package builds, `node scripts/database-command.mjs test broker-configuration data-health` uses synthetic secrets and vcp_test to check concurrent/idempotent saves, immutable audit evidence, encrypted storage, masked reads, old-session revocation, retained data, anonymous/CSRF/HTTP rejection, trusted-proxy handling and secret-free request logs. No live credentials are required.

Acceptance: six configuration/status/login/health integration checks passed, followed by two final runtime-status checks after adding explicit evidence-expiry fields. Database/API builds and lint passed. Tests include unreadable configuration and session keys, missing feed credentials, expired/mismatched IP proof, denied licensing, missing heartbeat, logout, session expiry across a new client, and unchanged candles/fills.
