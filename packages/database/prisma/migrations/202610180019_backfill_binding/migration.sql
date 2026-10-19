CREATE TABLE "BackfillBinding" (
 "runId" UUID PRIMARY KEY REFERENCES "HistoricalSyncRun"("id"),
 "credentialReference" UUID NOT NULL REFERENCES "BrokerCredential"("reference"),
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_backfill_binding BEFORE UPDATE OR DELETE ON "BackfillBinding" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
