# Verification and CI

KAN-26 configures ESLint for JS/TS, package-boundary enforcement, strict TypeScript, full builds, unit/API tests and isolated integration tests. GitHub Actions runs PostgreSQL 17 and Redis 7 service containers, applies all migrations, verifies database/Redis behavior and starts ephemeral API/web processes for authenticated UI tests. CI credentials are disposable fixture values, unrelated to application secrets.

Local checks:

- pnpm lint
- pnpm build
- pnpm typecheck
- pnpm test
- node scripts/database-command.mjs test
- node --test tests/worker.integration.mjs
- node --test tests/web.integration.mjs (running local preview)

For the isolated CI web harness, stop local preview servers first, run the PostgreSQL integration fixture, then node scripts/database-command.mjs test-web. It requires vcp_test and refuses occupied ports; it never changes the normal application owner or records synthetic trades in the application database. The harness closes its API/web children when done.

The CI-equivalent checks passed locally, including the isolated web harness. No remote GitHub Actions run has occurred because no Git remote is configured. This is not a claim of staging or production approval.
