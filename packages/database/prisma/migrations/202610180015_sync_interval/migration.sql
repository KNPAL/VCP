ALTER TABLE "HistoricalSyncRun" ADD COLUMN "interval" TEXT NOT NULL DEFAULT 'ONE_DAY' CHECK ("interval"='ONE_DAY');
