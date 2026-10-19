ALTER TABLE "StrengthReplayPlan" ADD COLUMN "dependencyKey" VARCHAR(64) UNIQUE;
ALTER TABLE "StrengthReplayPlan" ADD COLUMN "sourceReplayId" VARCHAR(64) REFERENCES "RelativeStrengthReplay"("id");
DROP INDEX strength_discovery_receipt;
CREATE UNIQUE INDEX strength_discovery_receipt ON "StrengthReplayPlan" ("indicatorReceiptId") WHERE "templateId" IS NULL AND "dependencyKey" IS NULL;
CREATE TABLE "ReplayDependencyCheck" (
 "indicatorReceiptId" VARCHAR(64) PRIMARY KEY REFERENCES "IndicatorReplayReceipt"("id"),
 "reason" TEXT,
 "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
