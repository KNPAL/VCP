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

On 2026-11-06, a fresh migrated test schema passed all 57 integration tests (393.6 seconds). A separate clean-source Docker Compose stack passed TLS owner login, session and dashboard checks; its containers were then removed. These are local results, not staging or production approval. Hosted CI remains outstanding: the user will run it, and workspace changes must remain local.

## Performance acceptance (KAN-134)

After building the workspace, run `node scripts/benchmark-scan-compute.mjs` for the reproducible 500-stock, 310-session compute workload. Fixture generation and previous-day structure preparation are outside the timed interval. The measured interval includes relative strength, breadth, indicators, structure detection, breakout evaluation and candidate ranking. On 2026-11-06, Node 24.15.0 on Windows with an Intel i5-8250U completed it in 72,921 ms, below the 120,000 ms target. Cross-cancelled exact rational arithmetic reduced the previous 234,511 ms result without introducing floating-point indicator calculations; 13 arithmetic, indicator and structure regression tests passed.

With the local test database running and workspace built, use `node scripts/database-command.mjs benchmark eod` for the 500-stock EOD/API workload and `node scripts/database-command.mjs benchmark risk` for protective-event latency (Redis defaults to port 56379). The helper reads the existing local password file without printing it. Each workload creates and finally drops its own schema, seeds synthetic data and explicit fixture-only source grants, and never changes the application database. The underlying scripts also accept `DATABASE_URL` for **vcp_test** when used directly. Keep the machine awake and avoid concurrent heavy workloads when measuring. Synthetic grants do not authorize real market-data use or satisfy production G04/G07 gates.

On 2026-11-06, 20 protective-event samples measured P95 4,856 ms against a 5,000 ms target. This used real Redis/PostgreSQL and the production monitor function at five-second cadence, one synthetic held position, and varied tick arrival phases; part of the run overlapped the EOD workload. Timing includes tick normalization/cache publication, polling delay and observation of the committed protective event. It excludes broker transport and unrelated worker dispatch jobs. This limited fixture is not a claim about all portfolio sizes or deployed worker contention.

Full EOD and API P95 acceptance remain pending until their measurements pass. KAN-134 remains In Progress.
