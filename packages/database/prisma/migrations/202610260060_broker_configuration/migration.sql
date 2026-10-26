CREATE TABLE "BrokerConfiguration" (
 "ownerId" UUID PRIMARY KEY REFERENCES "Owner"("id"),
 "revision" UUID NOT NULL UNIQUE,
 "accountKey" VARCHAR(64) NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL,
 "apiKeyMasked" TEXT NOT NULL,
 "clientCodeMasked" TEXT NOT NULL,
 "envelope" JSONB NOT NULL,
 "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BrokerConfigurationReceipt" (
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "key" TEXT NOT NULL CHECK (length("key") BETWEEN 1 AND 128),
 "fingerprint" VARCHAR(64) NOT NULL,
 "revision" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("ownerId","key")
);
CREATE TABLE "BrokerConfigurationEvent" (
 "id" UUID PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "revision" UUID NOT NULL,
 "previousRevision" UUID,
 "kind" TEXT NOT NULL CHECK ("kind"='CONFIGURATION_SAVED'),
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_broker_configuration_receipt BEFORE UPDATE OR DELETE ON "BrokerConfigurationReceipt" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_broker_configuration_event BEFORE UPDATE OR DELETE ON "BrokerConfigurationEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
