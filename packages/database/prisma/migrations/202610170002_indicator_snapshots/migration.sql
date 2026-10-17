CREATE TABLE "IndicatorSnapshot" (
 "id" UUID PRIMARY KEY, "listingId" UUID NOT NULL, "session" DATE NOT NULL,
 "strategyVersion" TEXT NOT NULL, "dataRevision" TEXT NOT NULL,
 "asOf" TIMESTAMPTZ(6) NOT NULL, "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "evidence" JSONB NOT NULL,
 UNIQUE("listingId","session","strategyVersion","dataRevision")
);
CREATE TRIGGER immutable_indicators BEFORE UPDATE OR DELETE ON "IndicatorSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
