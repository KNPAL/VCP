CREATE TABLE "HistoricalSyncRun" (
 "id" UUID PRIMARY KEY, "listingId" UUID NOT NULL, "provider" TEXT NOT NULL,
 "fromSession" DATE NOT NULL, "toSession" DATE NOT NULL, "asOf" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("fromSession"<="toSession")
);
CREATE TRIGGER immutable_sync_run BEFORE UPDATE OR DELETE ON "HistoricalSyncRun" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "HistoricalSyncWindow" (
 "id" UUID PRIMARY KEY, "runId" UUID NOT NULL REFERENCES "HistoricalSyncRun"("id"),
 "parentId" UUID REFERENCES "HistoricalSyncWindow"("id"), "fromSession" DATE NOT NULL, "toSession" DATE NOT NULL,
 "expectedSessions" JSONB NOT NULL, "state" TEXT NOT NULL CHECK ("state" IN ('PENDING','RUNNING','COMPLETE','PARTIAL','FAILED','SPLIT')),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 4),
 "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(6), "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reason" TEXT, "report" JSONB, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("fromSession"<="toSession" AND "toSession"-"fromSession"<400), UNIQUE ("runId","fromSession","toSession")
);
CREATE TABLE "HistoricalSyncAttempt" (
 "windowId" UUID NOT NULL REFERENCES "HistoricalSyncWindow"("id"), "attempt" INTEGER NOT NULL,
 "leaseToken" UUID NOT NULL, "outcome" TEXT NOT NULL, "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("windowId","attempt")
);
CREATE TRIGGER immutable_sync_attempt BEFORE UPDATE OR DELETE ON "HistoricalSyncAttempt" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE INDEX "sync_pending" ON "HistoricalSyncWindow" ("state","nextAttemptAt");
