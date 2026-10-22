CREATE TABLE "PositionStatusHistory" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "stopId" TEXT NOT NULL REFERENCES "InitialPositionStop"("id"),
 "recordedAt" TIMESTAMPTZ NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX position_status_stop_time ON "PositionStatusHistory" ("stopId","recordedAt" DESC);
CREATE TRIGGER immutable_position_status BEFORE UPDATE OR DELETE ON "PositionStatusHistory" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
