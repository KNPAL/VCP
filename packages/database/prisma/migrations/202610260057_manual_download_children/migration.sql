CREATE TABLE "ManualDownloadChild" (
 "manualRunId" UUID NOT NULL REFERENCES "ManualDownloadRun"("id"),
 "listingId" UUID NOT NULL,
 "syncRunId" UUID NOT NULL UNIQUE REFERENCES "HistoricalSyncRun"("id"),
 PRIMARY KEY ("manualRunId","listingId")
);
CREATE TRIGGER immutable_manual_download_child BEFORE UPDATE OR DELETE ON "ManualDownloadChild" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
