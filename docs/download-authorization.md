# Historical preview authorization

The preview API remains read-only: it does not store credentials, write candles or enqueue work. If `VCP_DOWNLOAD_PREVIEW_KEY_FILE` is configured, it returns a signed `previewToken` alongside the preview. If unset, `previewToken` is null and `authorization` is `NOT_CONFIGURED`. Download submission is still unavailable.

Generate a dedicated 32-byte key in a protected location whose parent already exists:

```powershell
node scripts/create-download-preview-key.mjs .runtime/download-preview.key
$env:VCP_DOWNLOAD_PREVIEW_KEY_FILE='D:\Codex\VCP\.runtime\download-preview.key'
```

Use your own absolute path outside this checkout when appropriate. Restrict access to the API service account using the platform's file permissions; on Windows, configure the file ACL. The generator refuses to overwrite an existing file and never prints the key. The file contains 32 raw bytes, not hexadecimal text. Do not commit or share it. Use a separate key from broker credential encryption. Configure the same protected file on every API instance and retain it across restarts. A rotation immediately invalidates outstanding previews. The API reads the file for signing and clears its in-memory buffer afterward; bad or unavailable files produce a sanitized 503 without disclosing the path or key.

The HMAC-SHA256 token binds the authenticated owner, requested universe/range/mode, five-minute issue/expiry times and a hash of the reviewed universe, instrument, source, calendar and candle revisions and planned ranges. It contains no broker credentials. It is signed, not encrypted. Signature verification uses a constant-time comparison; an altered token, wrong owner/key, future issue time or expired token is rejected.

The internal `authorizeDownloadPreview` helper additionally requires a freshly recomputed preview: identical evidence binding, passing source permissions, current broker readiness, known coverage plans and no blocked instruments. Evidence older than five seconds is rejected. A valid signature by itself never enables a download.

## Remaining integration

KAN-145 must call verification and fresh evidence authorization before enqueuing a job, preserve the same evidence/session binding transactionally, and revalidate permissions and session state in the existing worker before every provider request. Idempotency, cancellation, pause/resume, retry budgets and aggregate progress remain unfinished. This helper is not an implemented submission endpoint. KAN-144 also still needs authoritative provider-final-session discovery for unpopulated ranges. KAN-125's Submit/Download controls therefore remain disabled.

Verification: `node --test tests/download-authorization.test.mjs` covers tampering, owner/key mismatch, exact expiry, future timestamps, changed revisions/ranges and stale/blocked readiness. `node scripts/database-command.mjs test download-preview` covers the actual authenticated API's signed/unconfigured/invalid-key behavior using a temporary synthetic key, `vcp_test`, and an ephemeral port. No new migration is needed.
