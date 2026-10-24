CREATE TABLE "PaperOpeningExitDecision" (
 "id" TEXT PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "positionId" UUID NOT NULL,
 "session" DATE NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","positionId","session")
);
CREATE TRIGGER immutable_paper_opening_exit BEFORE UPDATE OR DELETE ON "PaperOpeningExitDecision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
