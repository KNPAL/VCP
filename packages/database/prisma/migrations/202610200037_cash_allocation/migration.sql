CREATE TABLE "PortfolioCashAllocation" (
 "id" TEXT PRIMARY KEY,
 "sequence" BIGSERIAL UNIQUE NOT NULL,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "cashEventId" UUID NOT NULL REFERENCES "PortfolioJournal"("id"),
 "episodeId" UUID NOT NULL REFERENCES "PortfolioJournal"("id"),
 "evidence" JSONB NOT NULL
);
CREATE INDEX portfolio_cash_allocation_owner ON "PortfolioCashAllocation" ("ownerId","cashEventId","sequence" DESC);
CREATE TRIGGER immutable_cash_allocation BEFORE UPDATE OR DELETE ON "PortfolioCashAllocation" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
