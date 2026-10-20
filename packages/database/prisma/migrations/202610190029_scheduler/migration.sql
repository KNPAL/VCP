CREATE TABLE "SchedulerLease" ("scope" TEXT PRIMARY KEY,"ownerId" UUID NOT NULL,"fence" BIGINT NOT NULL,"expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE TABLE "SchedulerStatus" ("scope" TEXT PRIMARY KEY,"evidence" JSONB NOT NULL,"checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "ScheduledScanRequest" ("id" UUID PRIMARY KEY,"scope" TEXT NOT NULL,"session" DATE NOT NULL,"evidence" JSONB NOT NULL,"createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("scope","session"));
CREATE TABLE "ScheduledScanDispatch" ("scanId" UUID PRIMARY KEY REFERENCES "ScheduledScanRequest"("id"),"state" TEXT NOT NULL,"reason" TEXT,"checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER immutable_scheduled_scan BEFORE UPDATE OR DELETE ON "ScheduledScanRequest" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
