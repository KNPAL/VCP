CREATE TABLE "PatternLifecycle" ("id" TEXT PRIMARY KEY,"patternId" TEXT NOT NULL,"listingId" UUID NOT NULL,"session" DATE NOT NULL,"configHash" TEXT NOT NULL,"state" TEXT NOT NULL,"asOf" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL,UNIQUE("patternId","session","configHash"));
CREATE INDEX pattern_lifecycle_history ON "PatternLifecycle" ("patternId","session");
CREATE TABLE "PatternTransition" ("id" TEXT PRIMARY KEY,"observationId" TEXT NOT NULL UNIQUE REFERENCES "PatternLifecycle"("id"),"patternId" TEXT NOT NULL,"evidence" JSONB NOT NULL);
CREATE TRIGGER immutable_pattern_lifecycle BEFORE UPDATE OR DELETE ON "PatternLifecycle" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_pattern_transition BEFORE UPDATE OR DELETE ON "PatternTransition" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
