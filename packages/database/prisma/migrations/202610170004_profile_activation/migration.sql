CREATE TABLE "StrategyActivation" (
 "id" UUID PRIMARY KEY, "profileId" VARCHAR(64) NOT NULL REFERENCES "StrategyProfile"("id"),
 "activatedAt" TIMESTAMPTZ(6) NOT NULL, "knownAt" TIMESTAMPTZ(6) NOT NULL,
 CHECK("activatedAt">="knownAt")
);
CREATE TRIGGER immutable_activations BEFORE UPDATE OR DELETE ON "StrategyActivation" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
