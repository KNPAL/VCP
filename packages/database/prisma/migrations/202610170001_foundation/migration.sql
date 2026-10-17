CREATE TABLE "Owner" (
 "id" UUID PRIMARY KEY, "login" TEXT NOT NULL UNIQUE, "passwordHash" TEXT NOT NULL,
 "role" TEXT NOT NULL DEFAULT 'OWNER' CHECK ("role" = 'OWNER'),
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "single_owner" ON "Owner" (("role"));
CREATE TABLE "Session" (
 "id" VARCHAR(64) PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id") ON DELETE CASCADE,
 "csrfHash" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(6) NOT NULL, CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "StrategyProfile" (
 "id" VARCHAR(64) PRIMARY KEY, "version" TEXT NOT NULL UNIQUE,
 "configuration" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CandleRevision" (
 "id" UUID PRIMARY KEY, "listingId" UUID NOT NULL, "session" DATE NOT NULL,
 "scale" TEXT NOT NULL CHECK ("scale" IN ('RAW','ADJUSTED')), "revision" INTEGER NOT NULL CHECK ("revision" > 0),
 "open" NUMERIC(20,6) NOT NULL, "high" NUMERIC(20,6) NOT NULL, "low" NUMERIC(20,6) NOT NULL, "close" NUMERIC(20,6) NOT NULL,
 "volume" BIGINT NOT NULL CHECK ("volume" >= 0), "source" TEXT NOT NULL,
 "receivedAt" TIMESTAMPTZ(6) NOT NULL, "finalizedAt" TIMESTAMPTZ(6), "adjustmentRevision" TEXT,
 CONSTRAINT "ohlc_valid" CHECK ("low" > 0 AND "high" >= "low" AND "open" BETWEEN "low" AND "high" AND "close" BETWEEN "low" AND "high"),
 CHECK (("scale" = 'RAW' AND "adjustmentRevision" IS NULL) OR ("scale" = 'ADJUSTED' AND "adjustmentRevision" IS NOT NULL)),
 UNIQUE ("listingId","session","scale","revision")
);
CREATE TABLE "IdempotencyRecord" (
 "id" UUID PRIMARY KEY, "ownerId" UUID NOT NULL REFERENCES "Owner"("id"), "key" TEXT NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL, "response" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("ownerId","key")
);
CREATE FUNCTION immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable evidence cannot be updated or deleted'; END; $$;
CREATE TRIGGER immutable_candles BEFORE UPDATE OR DELETE ON "CandleRevision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_profiles BEFORE UPDATE OR DELETE ON "StrategyProfile" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_idempotency BEFORE UPDATE OR DELETE ON "IdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
