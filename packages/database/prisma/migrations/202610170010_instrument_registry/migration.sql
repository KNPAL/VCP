CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE "Company" ("id" UUID PRIMARY KEY,"isin" VARCHAR(12) NOT NULL UNIQUE);
CREATE TABLE "Listing" ("id" UUID PRIMARY KEY,"companyId" UUID NOT NULL REFERENCES "Company"("id"),"exchange" TEXT NOT NULL CHECK("exchange" IN ('NSE','BSE')));
CREATE TABLE "InstrumentSnapshot" ("id" VARCHAR(64) PRIMARY KEY,"knownAt" TIMESTAMPTZ(6) NOT NULL,"sourceReference" TEXT NOT NULL,"evidence" JSONB NOT NULL);
CREATE TABLE "ListingMapping" (
 "id" VARCHAR(64) PRIMARY KEY,"snapshotId" VARCHAR(64) NOT NULL REFERENCES "InstrumentSnapshot"("id"),"listingId" UUID NOT NULL REFERENCES "Listing"("id"),
 "provider" TEXT NOT NULL,"token" TEXT NOT NULL,"validFrom" DATE NOT NULL,"validTo" DATE,"evidence" JSONB NOT NULL,
 CHECK("validTo" IS NULL OR "validTo">"validFrom"),
 EXCLUDE USING gist ("snapshotId" WITH =,"listingId" WITH =,"provider" WITH =,daterange("validFrom","validTo",'[)') WITH &&)
);
CREATE TABLE "UniverseSnapshot" ("id" VARCHAR(64) PRIMARY KEY,"knownAt" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL);
CREATE TABLE "ScanUniverseSnapshot" ("scanId" UUID PRIMARY KEY,"knownAt" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL);
CREATE TABLE "SectorSnapshot" ("id" VARCHAR(64) PRIMARY KEY,"knownAt" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL);
CREATE TRIGGER immutable_companies BEFORE UPDATE OR DELETE ON "Company" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_listings BEFORE UPDATE OR DELETE ON "Listing" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_instrument_snapshots BEFORE UPDATE OR DELETE ON "InstrumentSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_listing_mappings BEFORE UPDATE OR DELETE ON "ListingMapping" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_universe_snapshots BEFORE UPDATE OR DELETE ON "UniverseSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_scan_universes BEFORE UPDATE OR DELETE ON "ScanUniverseSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_sector_snapshots BEFORE UPDATE OR DELETE ON "SectorSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
