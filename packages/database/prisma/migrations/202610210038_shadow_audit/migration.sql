CREATE TABLE "ShadowReviewAudit" (
 "id" TEXT PRIMARY KEY,
 "ownerId" UUID NOT NULL REFERENCES "Owner"("id"),
 "recordedAt" TIMESTAMPTZ NOT NULL,
 "requestHash" TEXT NOT NULL,
 "evidence" JSONB NOT NULL
);
CREATE INDEX shadow_audit_owner_time ON "ShadowReviewAudit" ("ownerId","recordedAt" DESC);
CREATE TRIGGER immutable_shadow_audit BEFORE UPDATE OR DELETE ON "ShadowReviewAudit" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
