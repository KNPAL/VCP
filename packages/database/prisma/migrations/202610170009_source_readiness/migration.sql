CREATE TABLE "SourceSnapshot" (
 "id" VARCHAR(64) PRIMARY KEY, "dataset" TEXT NOT NULL, "knownAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ReadinessProof" (
 "id" VARCHAR(64) PRIMARY KEY, "gate" TEXT NOT NULL CHECK("gate" IN ('G01','G02','G03','G04','G05','G06','G07','G08','G09','G10')),
 "status" TEXT NOT NULL CHECK("status" IN ('PASS','FAIL','UNKNOWN')),
 "probeAt" TIMESTAMPTZ(6) NOT NULL, "sourceAt" TIMESTAMPTZ(6), "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 "evidence" JSONB NOT NULL, CHECK("expiresAt">"probeAt"), CHECK("sourceAt" IS NULL OR "sourceAt"<="probeAt"), CHECK("status"<>'PASS' OR "sourceAt" IS NOT NULL)
);
CREATE INDEX "ReadinessProof_gate_probeAt" ON "ReadinessProof"("gate","probeAt" DESC);
CREATE TRIGGER immutable_source_snapshots BEFORE UPDATE OR DELETE ON "SourceSnapshot" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_readiness_proofs BEFORE UPDATE OR DELETE ON "ReadinessProof" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
