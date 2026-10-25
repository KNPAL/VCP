CREATE TABLE "IpoListingSnapshot" (
 "id" TEXT PRIMARY KEY,
 "listingId" UUID NOT NULL,
 "knownAt" TIMESTAMPTZ NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL
);
CREATE INDEX "ipo_listing_known" ON "IpoListingSnapshot" ("listingId","knownAt" DESC,"recordedAt" DESC);
CREATE TRIGGER immutable_ipo_listing BEFORE UPDATE OR DELETE ON "IpoListingSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
