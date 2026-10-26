CREATE TABLE "ManualDownloadAction" (
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "key" TEXT NOT NULL CHECK (length("key") BETWEEN 1 AND 128),
 "runId" UUID NOT NULL REFERENCES "ManualDownloadRun"("id"),
 "action" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("ownerId","key")
);
CREATE TRIGGER immutable_manual_download_action BEFORE UPDATE OR DELETE ON "ManualDownloadAction" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
