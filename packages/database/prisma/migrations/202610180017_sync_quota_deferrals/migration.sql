-- Reservation attempts include quota deferrals. The four-failure policy counts
-- immutable FAILED/LEASE_EXPIRED evidence, not waits for a shared account budget.
ALTER TABLE "HistoricalSyncWindow" DROP CONSTRAINT "HistoricalSyncWindow_attempts_check";
ALTER TABLE "HistoricalSyncWindow" ADD CONSTRAINT "HistoricalSyncWindow_attempts_check" CHECK ("attempts">=0);
