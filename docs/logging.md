# Structured tracing

KAN-128 uses the server-only `@vcp/domain/logging` export; browser bundles do not import Node async context. Each API request gets a server-generated UUID returned in `X-Request-Id` and error envelopes. Incoming request IDs are not trusted. Concurrent requests retain separate async contexts.

JSON records have a closed schema: operation, correlationId, requestId, spanId, hashed jobId, startedAt, finishedAt, result, allowlisted failureCode, validated dataRevision and optional HTTP status. Payloads, URL/query strings, headers, cookies, PIN/TOTP, broker tokens, raw exceptions and stack messages are excluded rather than heuristically scrubbed. Unknown exception messages become INTERNAL_ERROR. Unverified revisions are null, never invented. A failed log sink cannot alter the business result.

API middleware records start and completion/abort. BullMQ handlers wrap each attempt and carry a stable hash of queue name plus job ID; nested broker calls inherit correlation and receive distinct span IDs. Historical request audit IDs match their broker trace span. Authentication and polling use the same tracer. `feed` and `alert.delivery` scopes are available for the still-unfinished feed/alert implementations; this change does not claim those features exist.

Operators can join API error requestId to request logs, nested spans and database historical-attempt requestId. Across job retries, use hashed jobId. No raw queue payload is logged. Logs go to process stdout for deployment collection; PostgreSQL remains authoritative for durable domain evidence. A centralized collector, retention policy and operational dashboards are separate deployment/observability work.

Verification covers asynchronous nesting and concurrent isolation, credential-bearing headers/cookies/query strings, spoofed IDs, unknown outcomes, failed sinks and actual API 401 correlation. Existing broker and Redis integration tests exercise the instrumented paths. Start/end records remain visible even when a handler throws, without serializing the exception.
