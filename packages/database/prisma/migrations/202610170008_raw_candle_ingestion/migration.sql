CREATE TABLE "CalendarSnapshot" (
 "id" VARCHAR(64) PRIMARY KEY, "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_calendar_snapshots BEFORE UPDATE OR DELETE ON "CalendarSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "RawDailyCandle" (
 "listingId" UUID NOT NULL, "session" DATE NOT NULL, "provider" TEXT NOT NULL,
 "revisionId" UUID NOT NULL REFERENCES "CandleRevision"("id"), "contentHash" VARCHAR(64) NOT NULL,
 "open" NUMERIC(20,6) NOT NULL, "high" NUMERIC(20,6) NOT NULL, "low" NUMERIC(20,6) NOT NULL, "close" NUMERIC(20,6) NOT NULL,
 "volume" BIGINT NOT NULL CHECK("volume">=0), "finalizedAt" TIMESTAMPTZ(6) NOT NULL, "receivedAt" TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY("listingId","session","provider"), CHECK("low">0 AND "high">="low" AND "open" BETWEEN "low" AND "high" AND "close" BETWEEN "low" AND "high"), CHECK("finalizedAt"<="receivedAt")
);
CREATE TABLE "CandleChangeOutbox" (
 "id" UUID PRIMARY KEY, "listingId" UUID NOT NULL, "session" DATE NOT NULL, "provider" TEXT NOT NULL,
 "beforeRevisionId" UUID REFERENCES "CandleRevision"("id"), "afterRevisionId" UUID NOT NULL UNIQUE REFERENCES "CandleRevision"("id"),
 "calendarHash" VARCHAR(64) NOT NULL REFERENCES "CalendarSnapshot"("id"),
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CandleQuarantine" (
 "id" UUID PRIMARY KEY, "listingId" UUID NOT NULL, "provider" TEXT NOT NULL,
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CandleCoverage" (
 "listingId" UUID NOT NULL, "provider" TEXT NOT NULL, "fromSession" DATE NOT NULL,
 "watermark" DATE, "checkedAt" TIMESTAMPTZ(6) NOT NULL, "evidence" JSONB NOT NULL,
 PRIMARY KEY("listingId","provider")
);
CREATE TRIGGER immutable_candle_changes BEFORE UPDATE OR DELETE ON "CandleChangeOutbox" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_candle_quarantine BEFORE UPDATE OR DELETE ON "CandleQuarantine" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
