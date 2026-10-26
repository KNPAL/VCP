# Historical preview authorization

The preview API remains read-only: it does not store credentials, write candles or enqueue work. If `VCP_DOWNLOAD_PREVIEW_KEY_FILE` is configured, it returns a signed `previewToken` alongside the preview. If unset, `previewToken` is null and `authorization` is `NOT_CONFIGURED`. When configured and enabled, the signed token is also returned as the opaque `previewId` accepted by POST `/api/v1/history/downloads`; `previewFingerprint` retains the human-readable revision. `submissionEnabled` reflects current acceptance readiness.

Generate a dedicated 32-byte key in a protected location whose parent already exists:

```powershell
node scripts/create-download-preview-key.mjs .runtime/download-preview.key
$env:VCP_DOWNLOAD_PREVIEW_KEY_FILE='D:\Codex\VCP\.runtime\download-preview.key'
```

Use your own absolute path outside this checkout when appropriate. Restrict access to the API service account using the platform's file permissions; on Windows, configure the file ACL. The generator refuses to overwrite an existing file and never prints the key. The file contains 32 raw bytes, not hexadecimal text. Do not commit or share it. Use a separate key from broker credential encryption. Configure the same protected file on every API instance and retain it across restarts. A rotation immediately invalidates outstanding previews. The API reads the file for signing and clears its in-memory buffer afterward; bad or unavailable files produce a sanitized 503 without disclosing the path or key.

The HMAC-SHA256 token binds the authenticated owner, requested universe/range/mode, five-minute issue/expiry times and a hash of the reviewed universe, instrument, source, calendar and candle revisions and planned ranges. It contains no broker credentials. It is signed, not encrypted. Signature verification uses a constant-time comparison; an altered token, wrong owner/key, future issue time or expired token is rejected.

The internal `authorizeDownloadPreview` helper additionally requires a freshly recomputed preview: identical evidence binding, passing source permissions, current broker readiness, known coverage plans and no blocked instruments. Evidence older than five seconds is rejected. A valid signature by itself never enables a download.

## Submission integration

KAN-145 now verifies authorization and current evidence transactionally before durable acceptance. Public owner-scoped submission, list, detail, cancel and retry endpoints are implemented behind the manual-download feature flag. Existing workers recheck source/session readiness. See [manual downloads](manual-downloads.md) for configuration and remaining verification. KAN-144 is Coded. Provider final-session evidence comes from the latest observed finalized candle or a stored PASSED historical probe matching account, listing and instrument mapping. A probe can authorize planning without importing its candles. Missing proof or verified calendar remains explicitly blocked. Preview requests never call the broker.

Verification: `node --test tests/download-authorization.test.mjs` covers tampering, owner/key mismatch, exact expiry, future timestamps, changed revisions/ranges and stale/blocked readiness. `node scripts/database-command.mjs test download-preview` covers the actual authenticated API's signed/unconfigured/invalid-key behavior using a temporary synthetic key, `vcp_test`, and an ephemeral port. No new migration is needed.
