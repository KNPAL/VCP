CREATE TABLE "AlertChannelPreference" (
 "ownerId" uuid PRIMARY KEY REFERENCES "Owner"(id),
 "browserEnabled" boolean NOT NULL DEFAULT false,
 "emailEnabled" boolean NOT NULL DEFAULT false
);
CREATE TABLE "AlertInboxReview" (
 "inboxId" text NOT NULL REFERENCES "InboxNotification"(id),
 "kind" text NOT NULL CHECK ("kind" IN ('ACKNOWLEDGED','DISMISSED')),
 "reviewedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("inboxId","kind")
);
CREATE TRIGGER immutable_alert_review BEFORE UPDATE OR DELETE ON "AlertInboxReview"
 FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
