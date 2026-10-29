# Backtest results (KAN-127)

The authenticated `/backtests` screen reads owner-scoped stored replay runs. Select a run to inspect its pinned strategy, data, universe, calendar, evaluation/warmup dates and cost table. Slippage is shown exactly as stored: the standard is 10 basis points (0.1%) each side; other archived assumptions are explicitly labeled NONSTANDARD_SLIPPAGE_RESEARCH, never rewritten.

The page displays the existing backend paper-performance report, equity and drawdown observations, closed-trade R and entry regime, blocked entry reasons and survivorship limitations. Missing ledgers or incomplete metrics remain UNKNOWN. Historical chart drilldown rebuilds the archived adjusted series at the selected cutoff, never from current quotes; paper fills retain their original raw prices and timestamps. A corrected/new snapshot cannot change an existing run's data revision. Values and chart observations have accessible tables, and UTC event times display in IST.

Prerequisite: build the workspace, apply the existing migrations, and import/run historical evidence using [historical snapshots](historical-snapshots.md) and the paper simulation workflows. These endpoints do not create runs or actual journal entries. Synthetic fixtures belong only in `vcp_test`.

API reads:

- `GET /api/v1/backtests` — latest 200 owner runs, with an explicit truncation flag.
- `GET /api/v1/backtests/:runId?asOf=<UTC instant>` — report and pinned source identities.
- `GET /api/v1/backtests/:runId/instruments/:isin?asOf=<UTC instant>` — historical adjusted OHLC/volume and paper fills.

## Training, validation and test windows

Use **Training and testing comparison** to select an archived strategy and independently filter each window by data snapshot, universe snapshot and exchange calendar. Then choose a stored run/date range for each phase. Open the assumptions disclosures to review the exact revisions and fee table before comparing.

The comparison endpoint resolves historical cutoffs and performance from owner-scoped archives. All three runs must be distinct, chronologically disjoint and use the same strategy configuration/code revision and cost table. Slippage must be 10 basis points (0.1%) on each side. Nonstandard archived runs remain inspectable in the results selector but cannot enter this standard comparison. Invalid selections, overlapping windows, mismatched costs and missing paper ledgers are rejected. Missing metrics are UNKNOWN; zero closed training trades yield INSUFFICIENT_TRAINING_EVIDENCE. Training alone determines eligibility; validation and out-of-sample metrics are displayed separately.

`POST /api/v1/backtests/compare` accepts only `{train, validation, test}` run IDs and requires the authenticated session and CSRF token. It is a read-only calculation: repeat requests return the same content-addressed result for the same stored evidence and create no events, orders or actual journal entries. Browser selection changes invalidate older results and abort outstanding requests.

Snapshot import and simulation execution use the existing [historical snapshot](historical-snapshots.md), [daily replay](historical-chronology.md) and [paper-ledger](paper-ledger.md) operator workflows. The results screen selects existing reproducible archives; it does not fabricate a new simulation by changing a stored cost or date field.

Validation: database/API/web builds and lint; isolated PostgreSQL owner/revision/cutoff, duplicate request, cost/window and missing-ledger checks; authenticated API/CSRF and browser loading/error/revision/selection/mobile/keyboard checks. Synthetic fixtures run only in vcp_test.

Current source rights apply even to old archives. Results, instrument bars and comparison reports require DISPLAY and DERIVE for the DAILY_CANDLES providers stored in the archive; unavailable rights return HTTP 403 without prices or metrics. Run metadata remains visible. Creating snapshots and persisting chronological replays require STORE and DERIVE, including retries. These checks do not grant source rights or change the historical market cutoff. See [registry setup and remaining rollout](registry-readiness.md).
