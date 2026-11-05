# Worker recovery drill

Use the disposable vcp_test database, local Redis and synthetic broker fixtures. Build the workspace, then run:

    node scripts/database-command.mjs test worker-recovery stream-context stream-owner position-monitor protective-stops alerts download-preview indicator-replay

Start with the stored owner and current broker configuration. The stream context test restores actual holdings and checks credentials, calendar and static-IP proof. The Redis stream-owner test forces a takeover, rejects callbacks from the previous owner and reconstructs subscriptions. Position monitoring records downtime and requires fresh observations. Protective stops are restored from persisted fills and scale evidence.

The delivery drill forks a process, waits for its PostgreSQL claim and kills that process. A fresh database client verifies the live lease prevents duplicate delivery, then the test advances the lease expiration and checks recovery. It asserts one alert, one inbox entry and zero portfolio events. The other suites exercise queue loss, idempotent retries, missing finalized sessions and immutable indicator reconstruction.

On 5 November 2026 all six recovery, stream, monitor, alert and EOD integration tests passed locally. The separate protective-stop, download and correction replay suites also passed. This records component and worker-process recovery in a local synthetic environment. Database restoration from an off-host backup is tracked separately in KAN-130.
