CREATE TABLE "PositionMonitor" ("ownerId" UUID NOT NULL REFERENCES "Owner"("id"),"isin" TEXT NOT NULL,"asOf" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL,PRIMARY KEY("ownerId","isin"));
CREATE TABLE "PositionMonitorEvent" ("id" TEXT PRIMARY KEY,"ownerId" UUID NOT NULL REFERENCES "Owner"("id"),"isin" TEXT NOT NULL,"eventAt" TIMESTAMPTZ(6) NOT NULL,"evidence" JSONB NOT NULL);
CREATE INDEX position_monitor_history ON "PositionMonitorEvent" ("ownerId","eventAt","id");
CREATE TRIGGER immutable_position_monitor_event BEFORE UPDATE OR DELETE ON "PositionMonitorEvent" FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
