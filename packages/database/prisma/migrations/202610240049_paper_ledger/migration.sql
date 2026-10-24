CREATE TABLE "PaperLedgerRevision" (
 "revision" TEXT PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "HistoricalReplayRun"("id"),
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "sequence" INTEGER NOT NULL,
 "parentRevision" TEXT REFERENCES "PaperLedgerRevision"("revision"),
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL,
 UNIQUE ("runId","sequence")
);
CREATE TRIGGER immutable_paper_ledger BEFORE UPDATE OR DELETE ON "PaperLedgerRevision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
