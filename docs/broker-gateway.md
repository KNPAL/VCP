# Broker request safeguards

KAN-30 uses one Redis rolling-window reservation per account, shared by every worker. Redis TIME and an atomic Lua transaction enforce default ceilings of 1 request/second, 60/minute and 3000/hour. Lower verified limits are retained in shared state, so a restarted worker using defaults cannot raise them. Every retry requires a new reservation. Missing Redis never authorizes a provider call. Redis uses the configured persistent volume and AOF; loss of quota history requires operational reconciliation before reconnecting a live account.

KAN-38 provides a read-only historical transport, bounded retry policy and PostgreSQL authentication circuit. Only the fixed historical candle endpoint is available, with NSE/BSE daily windows of at most 400 calendar days. Redirects are rejected, response bodies are bounded, requests have abortable timeouts, and credentials stay in internal headers. Source metadata, licensing, registered-IP verification and authenticated-session proof remain required inputs; this implementation does not assert those prerequisites are configured.

Authentication failures open the shared circuit. HTML/null/malformed successful responses also fail closed. Transient server, transport and 429 failures use up to four attempts, exponential delay and jitter. Long Retry-After values return control with retry timing rather than making an early request. Denied global reservations return RATE_LIMITED without contacting the broker. Successful empty arrays remain empty and do not imply complete coverage. Ingestion happens after a successful response, never inside a retry callback.

Circuit state survives process restarts. Restoration requires a fresh, recently verified session revision; prior revisions cannot be replayed to clear the circuit. Late errors from an older session cannot poison a restored session. Immutable attempt records retain timestamps, sanitized reason codes, HTTP status and retry delay. Raw response text, request headers and tokens are not included in audit records.

Error classification follows the official [SmartAPI error documentation](https://smartapi.angelone.in/docs/Exceptions), including token failures and transient AB1004/AB9000 responses. Endpoint and request fields follow the official [historical API documentation](https://smartapi.angelone.in/docs).

Tests use synthetic HTTP responses, PostgreSQL session evidence and real local Redis. No live broker request, login, quota probe or order has been performed. KAN-28 implements authentication/provisioning and encrypted credential references. Response normalization/probes (KAN-29) and window checkpoints (KAN-32) are Coded. Production backfill wiring (KAN-33) is implemented and tested with synthetic data. Full replay integration remains unfinished.


