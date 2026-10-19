CREATE TABLE "BrokerCredential" (
 "reference" UUID PRIMARY KEY, "accountKey" VARCHAR(64) NOT NULL,
 "sessionRevision" UUID NOT NULL, "keyId" VARCHAR(64) NOT NULL,
 "expiresAt" TIMESTAMPTZ(6) NOT NULL, "envelope" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("accountKey","sessionRevision"),
 FOREIGN KEY ("accountKey","sessionRevision") REFERENCES "BrokerSessionEvidence"("accountKey","sessionRevision")
);
CREATE TRIGGER immutable_broker_credential BEFORE UPDATE OR DELETE ON "BrokerCredential" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
