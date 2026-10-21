CREATE TABLE "PositionTrail" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "stopId" TEXT NOT NULL REFERENCES "InitialPositionStop"("id"),
 "session" DATE NOT NULL,
 "decidedAt" TIMESTAMPTZ NOT NULL,
 "effectiveAt" TIMESTAMPTZ,
 "state" TEXT NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX position_trail_stop_time ON "PositionTrail" ("stopId","session" DESC);
CREATE TRIGGER immutable_position_trail BEFORE UPDATE OR DELETE ON "PositionTrail" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
