CREATE TABLE "HistoricalReplayRun" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "snapshotId" UUID NOT NULL REFERENCES "HistoricalReplaySnapshot"("id"),
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL
);
CREATE TABLE "HistoricalReplayEvent" (
 "id" TEXT PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "session" DATE NOT NULL,
 "sourceAt" TIMESTAMPTZ NOT NULL,
 "occurredAt" TIMESTAMPTZ NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ NOT NULL,
 "strategyRevision" TEXT NOT NULL,
 "dataRevision" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","session"),
 CHECK ("sourceAt" <= "decidedAt" AND "occurredAt" <= "decidedAt" AND "decidedAt" <= "effectiveAt")
);
CREATE TRIGGER immutable_historical_run BEFORE UPDATE OR DELETE ON "HistoricalReplayRun" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_historical_event BEFORE UPDATE OR DELETE ON "HistoricalReplayEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
