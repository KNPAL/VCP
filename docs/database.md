# Database foundation

Run node scripts/init-local.mjs before Docker Compose. Secret files are local and ignored. Read the owner password directly from .runtime/owner-password when logging in; never put it into source or command arguments.

Start local services with docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d. Default compose publishes no database ports; dev override binds only loopback. Add -f infra/compose.app.yml to run the full local TLS stack. The proxy validates its local CA in health checks; system trust is not changed.

Set DATABASE_URL to the local PostgreSQL URL using the local secret, then run pnpm --filter @vcp/database generate and migrate. Set OWNER_LOGIN and OWNER_PASSWORD_FILE and run the seed command. Seed preserves an existing password and the database enforces one owner.

Migrations are forward-only. Verify each new migration against a fresh disposable database and a database with the previous version. For rollback, stop writers, restore the pre-deploy backup to a separate database, validate its migration history, then switch the connection. Never remove financial evidence or use migrate reset on an application database. A forward repair migration is preferred.

Candle revisions, profile records and idempotency responses are append-only at database level. Raw/adjusted scales are distinguished and adjusted candles require an adjustment revision.

