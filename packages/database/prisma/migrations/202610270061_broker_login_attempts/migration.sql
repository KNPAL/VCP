CREATE TABLE "BrokerLoginAttempt" (
 "id" UUID PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "configurationRevision" UUID NOT NULL,
 "accountKey" VARCHAR(64) NOT NULL,
 "state" TEXT NOT NULL CHECK ("state" IN ('AUTHENTICATING','CONNECTED','FAILED','SUPERSEDED')),
 "errorCode" TEXT,
 "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 "finishedAt" TIMESTAMPTZ(6),
 "sessionRevision" UUID
);
CREATE INDEX "broker_login_owner_time" ON "BrokerLoginAttempt" ("ownerId","startedAt");
CREATE TABLE "BrokerLoginEvent" (
 "id" UUID PRIMARY KEY,
 "attemptId" UUID NOT NULL REFERENCES "BrokerLoginAttempt"("id"),
 "state" TEXT NOT NULL,
 "errorCode" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_broker_login_event BEFORE UPDATE OR DELETE ON "BrokerLoginEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
