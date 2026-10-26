CREATE TABLE "ManualDownloadRun" (
 "id" UUID PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "requestHash" VARCHAR(64) NOT NULL,
 "state" TEXT NOT NULL CHECK ("state" IN ('QUEUED','RUNNING','PAUSED_AUTH','PAUSED_QUOTA','CANCEL_REQUESTED','CANCELLED','PARTIAL','FAILED','COMPLETED')),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX manual_download_active_request ON "ManualDownloadRun" ("ownerId","requestHash") WHERE "state" IN ('QUEUED','RUNNING','PAUSED_AUTH','PAUSED_QUOTA','CANCEL_REQUESTED','PARTIAL');
CREATE TABLE "ManualDownloadSubmission" (
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "key" TEXT NOT NULL CHECK (length("key") BETWEEN 1 AND 128),
 "requestHash" VARCHAR(64) NOT NULL,
 "runId" UUID NOT NULL REFERENCES "ManualDownloadRun"("id"),
 PRIMARY KEY ("ownerId","key")
);
CREATE TABLE "ManualDownloadEvent" (
 "id" UUID PRIMARY KEY,
 "runId" UUID NOT NULL REFERENCES "ManualDownloadRun"("id"),
 "state" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_manual_download_submission BEFORE UPDATE OR DELETE ON "ManualDownloadSubmission" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_manual_download_event BEFORE UPDATE OR DELETE ON "ManualDownloadEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
