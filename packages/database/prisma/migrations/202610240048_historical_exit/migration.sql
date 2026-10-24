CREATE TABLE "HistoricalExitDecision" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "positionId" TEXT NOT NULL,
 "session" DATE NOT NULL,
 "sourceAt" TIMESTAMPTZ NOT NULL,
 "occurredAt" TIMESTAMPTZ NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "strategyRevision" TEXT NOT NULL,
 "dataRevision" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","positionId","session")
);
CREATE TRIGGER immutable_historical_exit BEFORE UPDATE OR DELETE ON "HistoricalExitDecision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
