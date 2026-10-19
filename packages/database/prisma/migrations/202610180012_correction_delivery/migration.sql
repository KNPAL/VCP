CREATE TABLE "CorrectionReplayRequest" (
 "eventId" UUID PRIMARY KEY REFERENCES "CandleChangeOutbox"("id"),
 "listingId" UUID NOT NULL, "changedFrom" DATE NOT NULL,
 "dataRevision" UUID NOT NULL REFERENCES "CandleRevision"("id"),
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_correction_request BEFORE UPDATE OR DELETE ON "CorrectionReplayRequest" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "CandleDispatch" (
 "eventId" UUID PRIMARY KEY REFERENCES "CandleChangeOutbox"("id"), "jobId" TEXT,
 "state" TEXT NOT NULL, "attemptsMade" INTEGER NOT NULL CHECK ("attemptsMade">=0),
 "reason" TEXT, "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
