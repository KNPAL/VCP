CREATE TABLE "SmeResearchSnapshot" (
 "id" TEXT PRIMARY KEY,
 "listingId" UUID NOT NULL,
 "knownAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL
);
CREATE INDEX "sme_research_known" ON "SmeResearchSnapshot" ("listingId","knownAt" DESC,"recordedAt" DESC);
CREATE TRIGGER immutable_sme_research BEFORE UPDATE OR DELETE ON "SmeResearchSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
