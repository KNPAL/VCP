# Durable candle correction delivery

KAN-35 keeps raw current bars, immutable before/after revisions, coverage and change outbox in one database transaction. Unchanged content produces no event. The independent worker periodically dispatches pending events to BullMQ using a deterministic event-based job ID.

The queue payload contains only an event UUID. The processor reloads authoritative PostgreSQL evidence and inserts one immutable CorrectionReplayRequest per event. It carries the listing, first affected session, new raw revision, previous revision and calendar hash. Version-2 requests specify SESSION_ASC iteration and INDICATORS/MARKET_SIGNALS/VCP/SCANS ordering within each session, preserving yesterday's frozen READY pivot before today's VCP recompute. Its state is PENDING; delivery does not claim those stages have run. Existing version-1 receipts retain their original evidence on retries and need explicit handling by the future executor.

Redis acknowledgement is not the checkpoint. An outbox event stays eligible until PostgreSQL has its replay request, allowing lost queued jobs to be reconstructed. Concurrent dispatchers share the same job ID; duplicate processing uses the same immutable receipt. Pending events are ordered by last dispatch inspection so repeatedly failing jobs cannot permanently hide newer work. Exhausted jobs stay explicitly failed rather than being retried indefinitely. CandleDispatch exposes the latest queue state, attempt count and sanitized dependency failure.

The integration suite verifies concurrent duplicate dispatch, deletion/reconstruction of a synthetic Redis queue, eventual durable receipt, repeat processing, unknown/forged events and immutable receipts. All tests use vcp_test and uniquely named queues.

Executing the replay stages and propagating corporate-action changes remain KAN-60 work. The worker does not mark pending replay requests completed or rewrite original signals/decisions.
