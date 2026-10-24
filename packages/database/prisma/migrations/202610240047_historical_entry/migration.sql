CREATE TABLE "HistoricalEntryDecision" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "replayEventId" TEXT NOT NULL REFERENCES "HistoricalReplayEvent"("id"),
 "marketEventId" TEXT NOT NULL,
 "sourceAt" TIMESTAMPTZ NOT NULL,
 "occurredAt" TIMESTAMPTZ NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "strategyRevision" TEXT NOT NULL,
 "dataRevision" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","marketEventId")
);
CREATE TRIGGER immutable_historical_entry BEFORE UPDATE OR DELETE ON "HistoricalEntryDecision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
