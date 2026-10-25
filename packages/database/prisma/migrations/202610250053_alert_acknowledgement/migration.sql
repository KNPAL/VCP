CREATE TABLE "PositionAlertAcknowledgement" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "signalId" TEXT NOT NULL,
 "isin" TEXT NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "evidence" JSONB NOT NULL,
 UNIQUE ("ownerId","signalId")
);
CREATE TRIGGER immutable_position_acknowledgement BEFORE UPDATE OR DELETE ON "PositionAlertAcknowledgement" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
