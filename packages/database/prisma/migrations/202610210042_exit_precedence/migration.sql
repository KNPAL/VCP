CREATE TABLE "ExitResolution" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "signalId" TEXT UNIQUE NOT NULL,
 "recordedAt" TIMESTAMPTZ NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE TABLE "ExitDecision" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "stopId" TEXT NOT NULL REFERENCES "InitialPositionStop"("id"),
 "recordedAt" TIMESTAMPTZ NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX exit_decision_stop_time ON "ExitDecision" ("stopId","recordedAt" DESC);
CREATE TRIGGER immutable_exit_resolution BEFORE UPDATE OR DELETE ON "ExitResolution" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_exit_decision BEFORE UPDATE OR DELETE ON "ExitDecision" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
