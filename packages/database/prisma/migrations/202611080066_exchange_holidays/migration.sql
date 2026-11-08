CREATE TABLE "ExchangeHoliday" (
 "exchange" TEXT NOT NULL,
 "segment" TEXT NOT NULL,
 "date" DATE NOT NULL,
 "name" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('CLOSED', 'MUHURAT_SESSION')),
 "weekend" BOOLEAN NOT NULL,
 "evidence" JSONB NOT NULL,
 "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("exchange", "segment", "date")
);
