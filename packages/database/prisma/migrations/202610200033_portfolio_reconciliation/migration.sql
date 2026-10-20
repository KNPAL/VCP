CREATE TABLE "PortfolioReconciliation" ("id" TEXT PRIMARY KEY,"ownerId" UUID NOT NULL REFERENCES "Owner"("id"),"asOf" TIMESTAMPTZ(6) NOT NULL,"decidedAt" TIMESTAMPTZ(6) NOT NULL,"journalHash" TEXT NOT NULL,"evidence" JSONB NOT NULL);
CREATE INDEX portfolio_reconciliation_owner ON "PortfolioReconciliation" ("ownerId","decidedAt","id");
CREATE TRIGGER immutable_portfolio_reconciliation BEFORE UPDATE OR DELETE ON "PortfolioReconciliation" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
