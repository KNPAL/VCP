CREATE TABLE "InstrumentMasterImport" (
 "id" VARCHAR(64) PRIMARY KEY,
 "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "evidence" JSONB NOT NULL
);
CREATE TRIGGER immutable_instrument_master_import BEFORE UPDATE OR DELETE ON "InstrumentMasterImport" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
