CREATE TABLE "DailyStructureExecution" (
 "id" TEXT PRIMARY KEY,
 "listingId" UUID NOT NULL,
 "session" DATE NOT NULL,
 "configHash" VARCHAR(64) NOT NULL REFERENCES "StrategyProfile"("id"),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("listingId","session")
);
CREATE TRIGGER immutable_daily_structure BEFORE UPDATE OR DELETE ON "DailyStructureExecution" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
