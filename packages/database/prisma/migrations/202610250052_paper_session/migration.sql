CREATE TABLE "PaperSessionResult" (
 "id" TEXT PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "session" DATE NOT NULL,
 "requestHash" TEXT NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","session")
);
CREATE TRIGGER immutable_paper_session BEFORE UPDATE OR DELETE ON "PaperSessionResult" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
