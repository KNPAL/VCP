# BUY signals (KAN-121, In Progress)

Open `/buy` after signing in. The screen reads the latest 50 known market events, selecting one revision per logical event, independently of owner-scoped entry plans. It shows frozen pivot, completed close, exact RVOL50 ratio, contraction low, source revision and server-calculated plan evidence. Missing plans, expired observations and quotes older than 30 seconds cannot display current eligibility. Times use IST with raw source ages.

Revalidate plan uses the authenticated portfolio valuation and existing CSRF-protected, idempotent entry-plan API. It accepts estimated fees only; the browser never supplies quotes or PASS gates. Revalidation does not create an order or fill. The manual BUY link opens the actual portfolio journal, where outside fills remain recordable independently of signal eligibility.

The read-only `GET /api/v1/portfolio/signals` endpoint excludes future occurrence, observation and decision timestamps. Owner plans come from `GET /api/v1/portfolio/risk/plans`; current source/journal invalidation remains enforced by the backend.

## Remaining acceptance

The current entry-risk service deliberately returns BUY_BLOCKED because live heartbeat, broker settlement and G06 evidence have not yet been connected to its evaluation. Completing that backend authority path and the full fresh-plan/manual-fill acceptance is required before KAN-121 can be Coded. The UI never converts these missing checks into permission. Workspace changes are not deployed.

Run `node scripts/database-command.mjs test entry-risk` after the database integration fixtures. Set `VCP_BUY_SIGNALS_TEST=true` for `test-web` using the isolated browser setup in the root README. The focused browser suite covers revalidation, expired plans, 403/503 recovery, empty evidence and mobile overflow.
