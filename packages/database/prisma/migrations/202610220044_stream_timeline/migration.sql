CREATE TABLE "StreamTimeline" (
 "sequence" BIGSERIAL PRIMARY KEY,
 "id" TEXT NOT NULL UNIQUE,
 "ownerId" UUID REFERENCES "Owner"("id"),
 "listingId" UUID,
 "kind" TEXT NOT NULL,
 "eventAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "sourceAt" TIMESTAMPTZ,
 "revision" TEXT NOT NULL,
 "reference" JSONB NOT NULL
);
CREATE INDEX stream_owner_sequence ON "StreamTimeline" ("ownerId","sequence");
CREATE INDEX stream_listing_sequence ON "StreamTimeline" ("listingId","sequence");
CREATE TRIGGER immutable_stream_timeline BEFORE UPDATE OR DELETE ON "StreamTimeline" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
