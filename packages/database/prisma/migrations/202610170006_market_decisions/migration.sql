CREATE TABLE "MarketEvent" (
 "id" VARCHAR(64) PRIMARY KEY, "logicalId" VARCHAR(64) NOT NULL,
 "listingId" UUID NOT NULL, "session" DATE NOT NULL, "type" TEXT NOT NULL CHECK("type" IN ('BREAKOUT_CONFIRMED','BREAKOUT_PRICE_ONLY')),
 "configHash" VARCHAR(64) NOT NULL REFERENCES "StrategyProfile"("id"), "dataRevision" TEXT NOT NULL,
 "occurredAt" TIMESTAMPTZ(6) NOT NULL, "observedAt" TIMESTAMPTZ(6) NOT NULL, "decidedAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, UNIQUE("logicalId","configHash","dataRevision"), CHECK("occurredAt"<="observedAt" AND "observedAt"<="decidedAt")
);
CREATE TABLE "UserSignalDecision" (
 "id" VARCHAR(64) PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "marketEventId" VARCHAR(64) NOT NULL REFERENCES "MarketEvent"("id"),
 "state" TEXT NOT NULL CHECK("state" IN ('BUY_ELIGIBLE','BUY_BLOCKED')),
 "decidedAt" TIMESTAMPTZ(6) NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, CHECK("expiresAt"="decidedAt"+INTERVAL '30 seconds')
);
CREATE TRIGGER immutable_market_events BEFORE UPDATE OR DELETE ON "MarketEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_user_decisions BEFORE UPDATE OR DELETE ON "UserSignalDecision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
