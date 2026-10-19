ALTER TABLE "StrengthReplayPlan" ALTER COLUMN "templateId" DROP NOT NULL;
CREATE UNIQUE INDEX strength_discovery_receipt ON "StrengthReplayPlan" ("indicatorReceiptId") WHERE "templateId" IS NULL;
CREATE TABLE "ReplayContextDiscovery" (
 "indicatorReceiptId" VARCHAR(64) PRIMARY KEY REFERENCES "IndicatorReplayReceipt"("id"),
 "state" TEXT NOT NULL,
 "reason" TEXT,
 "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
