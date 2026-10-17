CREATE TABLE "PatternSnapshot" (
 "id" UUID PRIMARY KEY, "patternId" VARCHAR(64) NOT NULL, "listingId" UUID NOT NULL,
 "session" DATE NOT NULL, "dataRevision" TEXT NOT NULL, "adjustmentRevision" TEXT NOT NULL,
 "asOf" TIMESTAMPTZ(6) NOT NULL, "decidedAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, UNIQUE("patternId","session","dataRevision"), CHECK("decidedAt">="asOf")
);
CREATE TABLE "PatternReplacement" (
 "oldId" VARCHAR(64) PRIMARY KEY, "replacedById" VARCHAR(64) NOT NULL,
 "reason" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("oldId"<>"replacedById")
);
CREATE TRIGGER immutable_pattern_snapshots BEFORE UPDATE OR DELETE ON "PatternSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_pattern_replacements BEFORE UPDATE OR DELETE ON "PatternReplacement" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
