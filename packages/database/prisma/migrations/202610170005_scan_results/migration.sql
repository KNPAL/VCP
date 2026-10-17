CREATE TABLE "ScanResult" (
 "id" UUID PRIMARY KEY, "asOf" TIMESTAMPTZ(6) NOT NULL,
 "configHash" VARCHAR(64) NOT NULL REFERENCES "StrategyProfile"("id"),
 "dataRevision" TEXT NOT NULL, "status" TEXT NOT NULL CHECK ("status" IN ('COMPLETE','PARTIAL','ERROR')),
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ScanResult_asOf" ON "ScanResult"("asOf" DESC);
CREATE TRIGGER immutable_scan_results BEFORE UPDATE OR DELETE ON "ScanResult" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
