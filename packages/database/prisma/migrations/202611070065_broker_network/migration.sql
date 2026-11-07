CREATE TABLE "BrokerNetworkConfiguration" (
 "ownerId" uuid PRIMARY KEY REFERENCES "Owner"(id),
 revision uuid NOT NULL UNIQUE,
 evidence jsonb NOT NULL,
 "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "BrokerNetworkEvent" (
 id uuid PRIMARY KEY,
 "ownerId" uuid NOT NULL REFERENCES "Owner"(id),
 "previousRevision" uuid,
 evidence jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION broker_network_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Broker network events are immutable'; END $$;
CREATE TRIGGER broker_network_event_no_change BEFORE UPDATE OR DELETE ON "BrokerNetworkEvent" FOR EACH ROW EXECUTE FUNCTION broker_network_event_immutable();
