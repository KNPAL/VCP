CREATE TABLE "StructureReplayResult" (
 "id" VARCHAR(64) PRIMARY KEY,
 "indicatorReceiptId" VARCHAR(64) NOT NULL REFERENCES "IndicatorReplayReceipt"("id"),
 "instrumentSnapshotId" VARCHAR(64) NOT NULL REFERENCES "InstrumentSnapshot"("id"),
 "profileId" TEXT NOT NULL REFERENCES "StrategyProfile"("id"),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_structure_replay BEFORE UPDATE OR DELETE ON "StructureReplayResult" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
