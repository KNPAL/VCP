CREATE TABLE "HistoricalReplaySnapshot" (
 "id" UUID PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "requestId" TEXT NOT NULL,
 "snapshotHash" TEXT NOT NULL,
 "sourceAt" TIMESTAMPTZ NOT NULL,
 "occurredAt" TIMESTAMPTZ NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ NOT NULL,
 "strategyRevision" TEXT NOT NULL,
 "dataRevision" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 UNIQUE ("ownerId","requestId"),
 CHECK ("sourceAt" <= "decidedAt" AND "occurredAt" <= "decidedAt" AND "decidedAt" <= "effectiveAt")
);
CREATE TRIGGER immutable_historical_snapshot BEFORE UPDATE OR DELETE ON "HistoricalReplaySnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
