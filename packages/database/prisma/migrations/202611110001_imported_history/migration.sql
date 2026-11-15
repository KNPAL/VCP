CREATE TABLE "HistoricalDataImport" (
 "id" text PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "Owner"("id"),
 "sourceSnapshotId" text NOT NULL, "status" text NOT NULL, "manifest" jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "HistoricalImportRecord" (
 "importId" text NOT NULL REFERENCES "HistoricalDataImport"("id"),
 "sourceTable" text NOT NULL, "sourceId" text NOT NULL, "evidence" jsonb NOT NULL,
 PRIMARY KEY ("importId","sourceTable","sourceId")
);
CREATE TABLE "HistoricalResearchBar" (
 "importId" text NOT NULL REFERENCES "HistoricalDataImport"("id"),
 "symbol" text NOT NULL, "series" text NOT NULL, "session" date NOT NULL,
 "open" numeric(20,6) NOT NULL, "high" numeric(20,6) NOT NULL,
 "low" numeric(20,6) NOT NULL, "close" numeric(20,6) NOT NULL,
 "volume" bigint NOT NULL, "source" text NOT NULL,
 "quality" text NOT NULL, "reasons" jsonb NOT NULL,
 PRIMARY KEY ("importId","symbol","series","session")
);
CREATE INDEX "HistoricalDataImport_owner_created" ON "HistoricalDataImport"("ownerId","createdAt" DESC);
