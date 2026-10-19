CREATE TABLE "IndicatorReplayReceipt" (
 "id" VARCHAR(64) PRIMARY KEY,
 "eventId" UUID NOT NULL REFERENCES "CorrectionReplayRequest"("eventId"),
 "adjustmentId" VARCHAR(64) NOT NULL REFERENCES "AdjustmentSnapshot"("id"),
 "calendarHash" VARCHAR(64) NOT NULL REFERENCES "CalendarSnapshot"("id"),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_indicator_replay BEFORE UPDATE OR DELETE ON "IndicatorReplayReceipt" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "IndicatorReplayDispatch" (
 "eventId" UUID NOT NULL REFERENCES "CorrectionReplayRequest"("eventId"),
 "adjustmentId" VARCHAR(64) NOT NULL REFERENCES "AdjustmentSnapshot"("id"),
 "calendarHash" VARCHAR(64) NOT NULL REFERENCES "CalendarSnapshot"("id"),
 "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "state" TEXT NOT NULL,
 PRIMARY KEY ("eventId","adjustmentId","calendarHash")
);
