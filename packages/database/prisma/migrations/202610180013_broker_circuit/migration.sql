CREATE TABLE "BrokerCircuit" (
 "accountKey" VARCHAR(64) PRIMARY KEY, "sessionRevision" UUID NOT NULL,
 "open" BOOLEAN NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 "reason" TEXT, "verifiedAt" TIMESTAMPTZ(6) NOT NULL, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BrokerSessionEvidence" (
 "accountKey" VARCHAR(64) NOT NULL, "sessionRevision" UUID NOT NULL,
 "verifiedAt" TIMESTAMPTZ(6) NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY ("accountKey","sessionRevision")
);
CREATE TRIGGER immutable_broker_session BEFORE UPDATE OR DELETE ON "BrokerSessionEvidence" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "BrokerRequestAttempt" (
 "accountKey" VARCHAR(64) NOT NULL, "requestId" UUID NOT NULL,
 "attempt" INTEGER NOT NULL CHECK ("attempt" BETWEEN 1 AND 4),
 "at" TIMESTAMPTZ(6) NOT NULL, "reason" TEXT, "httpStatus" INTEGER, "retryInMs" INTEGER,
 PRIMARY KEY ("accountKey","requestId","attempt")
);
CREATE TRIGGER immutable_broker_attempt BEFORE UPDATE OR DELETE ON "BrokerRequestAttempt" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
