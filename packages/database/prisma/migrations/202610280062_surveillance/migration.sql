CREATE TABLE "SurveillanceSnapshot" (
 "id" VARCHAR(64) PRIMARY KEY,
 "listingId" UUID NOT NULL,
 "knownAt" TIMESTAMPTZ(6) NOT NULL,
 "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "evidence" JSONB NOT NULL
);
CREATE INDEX surveillance_listing_time ON "SurveillanceSnapshot" ("listingId","knownAt" DESC,"recordedAt" DESC);
CREATE TRIGGER immutable_surveillance_snapshot BEFORE UPDATE OR DELETE ON "SurveillanceSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
