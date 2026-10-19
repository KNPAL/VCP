CREATE TABLE "AdjustmentSnapshot" (
 "id" VARCHAR(64) PRIMARY KEY, "listingId" UUID NOT NULL, "scaleSession" DATE NOT NULL,
 "asOf" TIMESTAMPTZ(6) NOT NULL, "state" TEXT NOT NULL CHECK ("state" IN ('KNOWN','UNKNOWN')),
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AdjustedDailyCandle" (
 "adjustmentId" VARCHAR(64) NOT NULL REFERENCES "AdjustmentSnapshot"("id"),
 "rawRevisionId" UUID NOT NULL REFERENCES "CandleRevision"("id"), "session" DATE NOT NULL,
 "open" NUMERIC(20,6) NOT NULL, "high" NUMERIC(20,6) NOT NULL,
 "low" NUMERIC(20,6) NOT NULL, "close" NUMERIC(20,6) NOT NULL,
 "volume" NUMERIC(24,8) NOT NULL CHECK ("volume">=0), "evidence" JSONB NOT NULL,
 PRIMARY KEY ("adjustmentId","session"),
 CHECK ("low">0 AND "high">="low" AND "open" BETWEEN "low" AND "high" AND "close" BETWEEN "low" AND "high")
);
CREATE TRIGGER immutable_adjustment_snapshot BEFORE UPDATE OR DELETE ON "AdjustmentSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_adjusted_candle BEFORE UPDATE OR DELETE ON "AdjustedDailyCandle" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
