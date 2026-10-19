CREATE TABLE "RelativeStrengthReplay" (
 "id" VARCHAR(64) PRIMARY KEY,
 "indicatorReceiptId" VARCHAR(64) NOT NULL REFERENCES "IndicatorReplayReceipt"("id"),
 "instrumentSnapshotId" VARCHAR(64) NOT NULL REFERENCES "InstrumentSnapshot"("id"),
 "profileId" VARCHAR(64) NOT NULL REFERENCES "StrategyProfile"("id"),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_rs_replay BEFORE UPDATE OR DELETE ON "RelativeStrengthReplay" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
ALTER TABLE "StructureReplayResult" ADD COLUMN "strengthReplayId" VARCHAR(64) REFERENCES "RelativeStrengthReplay"("id");
CREATE TABLE "StructureReplayDispatch" (
 "strengthReplayId" VARCHAR(64) PRIMARY KEY REFERENCES "RelativeStrengthReplay"("id"),
 "state" TEXT NOT NULL,
 "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
