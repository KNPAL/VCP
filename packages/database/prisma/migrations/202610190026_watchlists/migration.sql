CREATE TABLE "Watchlist" (
 "id" UUID PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "name" TEXT NOT NULL, "filters" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("ownerId","name")
);
CREATE TABLE "WatchlistItem" (
 "watchlistId" UUID NOT NULL REFERENCES "Watchlist"("id"),
 "listingId" UUID NOT NULL REFERENCES "Listing"("id"),
 "evidence" JSONB NOT NULL, "savedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("watchlistId","listingId")
);
CREATE TABLE "WatchlistAudit" (
 "id" UUID PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "watchlistId" UUID NOT NULL REFERENCES "Watchlist"("id"),
 "action" TEXT NOT NULL, "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_watchlist_audit BEFORE UPDATE OR DELETE ON "WatchlistAudit" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
