ALTER TABLE "ManualDownloadChild" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0 CHECK ("generation">=0);
ALTER TABLE "ManualDownloadChild" DROP CONSTRAINT "ManualDownloadChild_pkey";
ALTER TABLE "ManualDownloadChild" ADD PRIMARY KEY ("manualRunId","listingId","generation");
