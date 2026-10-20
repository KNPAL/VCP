CREATE TABLE "EntryRiskPlan" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "marketEventId" TEXT NOT NULL REFERENCES "MarketEvent"("id"),
 "asOf" TIMESTAMPTZ(6) NOT NULL,
 "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 "journalHash" TEXT NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX entry_risk_owner_time ON "EntryRiskPlan" ("ownerId","asOf" DESC);
CREATE TRIGGER immutable_entry_risk BEFORE UPDATE OR DELETE ON "EntryRiskPlan" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
