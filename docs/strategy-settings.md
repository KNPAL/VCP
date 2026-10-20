# Strategy settings and immutable versions

The authenticated `/settings` page displays the supported ST_VCP_4_0 rules, exact stored parameter values, SHA-256 configuration identities, creation times in IST and activation history. No registered or active profile is explicitly UNKNOWN. Market freshness is separate from configuration availability.

**Register default version** idempotently saves the fixed supported configuration. **Save new version** creates an immutable draft under a new `ST_VCP_...` name. The name also becomes the configuration's version, so its content hash identifies that version. Repeated identical requests return the same record, including concurrent requests. Reusing a name with different content fails with 409. Invalid fields, decimal formats or automatic-order authority fail with 422. Authenticated mutations require CSRF.

Saving never activates a version or modifies historical scans. The execution engine currently accepts only the exact supported default hash; other saved versions are visibly marked **Draft — execution unsupported**. They require a corresponding engine implementation and verification before operational use. The UI does not offer activation of unsupported parameters. Existing activation history is read-only. This preserves the pinned hashes used by scans and replay; it does not claim a configurable live engine or completed backtesting UI.

The JSON editor accepts the closed configuration schema, not broker credentials. Automatic orders and automatic additions remain false. The fixed trailing contract (EMA21 plus 0.5 ATR, next-session effective) is displayed separately because it is not a configurable field in the current engine.

API: `GET /api/v1/vcp/profiles` returns defaults, registered versions, supported hash, current active identity and activation history. `POST /api/v1/vcp/profiles` accepts `{version,configuration}` and returns the immutable identity with `activationChanged:false`.

Verification uses unit validation and isolated PostgreSQL tests for permissions, simultaneous duplicate saves, immutable conflicts, automatic-order rejection and preservation of existing scan/activation evidence. `tests/profile-settings.browser.mjs` exercises empty/UNKNOWN, malformed JSON, saving a draft, service failure/recovery, mobile layout and keyboard access. Run it with the same Playwright configuration documented in `screener.md`.
