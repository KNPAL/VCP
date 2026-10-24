CREATE TABLE "PaperProtectionPlan" (
 "id" TEXT PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "episodeId" UUID NOT NULL,
 "isin" TEXT NOT NULL,
 "session" DATE NOT NULL,
 "sourceAt" TIMESTAMPTZ NOT NULL,
 "occurredAt" TIMESTAMPTZ NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","episodeId","session")
);
CREATE TRIGGER immutable_paper_protection BEFORE UPDATE OR DELETE ON "PaperProtectionPlan" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
