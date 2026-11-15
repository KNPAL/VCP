CREATE TABLE "ImportedVcpResearchScan" (
 id text PRIMARY KEY,
 "ownerId" uuid NOT NULL,
 "importId" text NOT NULL,
 session date NOT NULL,
 evidence jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ImportedVcpResearchScan_owner_created" ON "ImportedVcpResearchScan"("ownerId","createdAt" DESC);
