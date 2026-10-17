CREATE TABLE "PortfolioJournal" (
 "id" UUID PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "sequence" INTEGER NOT NULL CHECK("sequence">0), "kind" TEXT NOT NULL,
 "occurredAt" TIMESTAMPTZ(6) NOT NULL, "recordedAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, UNIQUE("ownerId","sequence"), CHECK("occurredAt"<="recordedAt")
);
CREATE TRIGGER immutable_portfolio_journal BEFORE UPDATE OR DELETE ON "PortfolioJournal" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
