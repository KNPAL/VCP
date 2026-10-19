CREATE TABLE "StrengthReplayPlan" (
 "id" VARCHAR(64) PRIMARY KEY,
 "indicatorReceiptId" VARCHAR(64) NOT NULL REFERENCES "IndicatorReplayReceipt"("id"),
 "templateId" VARCHAR(64) NOT NULL REFERENCES "RelativeStrengthReplay"("id"),
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("indicatorReceiptId","templateId")
);
CREATE TRIGGER immutable_strength_plan BEFORE UPDATE OR DELETE ON "StrengthReplayPlan" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE "StrengthReplayDispatch" (
 "planId" VARCHAR(64) PRIMARY KEY REFERENCES "StrengthReplayPlan"("id"),
 "state" TEXT NOT NULL,
 "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
