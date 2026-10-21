CREATE TABLE "PartialProfitSignal" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "stopId" TEXT UNIQUE NOT NULL REFERENCES "InitialPositionStop"("id"),
 "recognizedAt" TIMESTAMPTZ NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE TABLE "PartialProfitResolution" (
 "id" TEXT PRIMARY KEY,
 "signalId" TEXT NOT NULL REFERENCES "PartialProfitSignal"("id"),
 "recordedAt" TIMESTAMPTZ NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX partial_resolution_signal ON "PartialProfitResolution" ("signalId");
CREATE TRIGGER immutable_partial_signal BEFORE UPDATE OR DELETE ON "PartialProfitSignal" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_partial_resolution BEFORE UPDATE OR DELETE ON "PartialProfitResolution" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
