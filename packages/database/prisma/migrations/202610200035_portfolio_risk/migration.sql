CREATE TABLE "PortfolioRiskSnapshot" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "asOf" TIMESTAMPTZ(6) NOT NULL,
 "journalHash" TEXT NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX portfolio_risk_owner_time ON "PortfolioRiskSnapshot" ("ownerId","asOf" DESC);
CREATE TRIGGER immutable_portfolio_risk BEFORE UPDATE OR DELETE ON "PortfolioRiskSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
