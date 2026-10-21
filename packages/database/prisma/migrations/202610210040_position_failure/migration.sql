CREATE TABLE "PositionFailure" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "stopId" TEXT NOT NULL REFERENCES "InitialPositionStop"("id"),
 "session" DATE NOT NULL,
 "recognizedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ,
 "state" TEXT NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX position_failure_owner_time ON "PositionFailure" ("ownerId","recognizedAt" DESC);
CREATE TRIGGER immutable_position_failure BEFORE UPDATE OR DELETE ON "PositionFailure" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
