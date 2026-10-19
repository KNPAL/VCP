CREATE TABLE "HistoricalProbe" (
 "id" UUID PRIMARY KEY, "accountKey" VARCHAR(64) NOT NULL CHECK ("accountKey" ~ '^[0-9a-f]{64}$'),
 "revision" VARCHAR(64) NOT NULL CHECK ("revision" ~ '^[0-9a-f]{64}$'),
 "asOf" TIMESTAMPTZ(6) NOT NULL, "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_historical_probe BEFORE UPDATE OR DELETE ON "HistoricalProbe" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
