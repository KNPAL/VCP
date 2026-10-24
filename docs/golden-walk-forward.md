# Frozen replay fixtures and walk-forward comparisons

The synthetic fixture manifest is `fixtures/historical-golden-manifest.json`. It pins the full replay and entry fixture hashes, including bars, timestamps, strategy configuration, seed, fees and assumptions. Its thirteen case groups cover deterministic VCP, i+3 confirmation, no same-close entry, chase and stop-width rejection, FIFO, partial profit, same-bar stop-first, splits, missing-data restore, position competition, IPO/SME exclusion and G01–G10. Hash changes require an intentional fixture-version review; the runner does not regenerate expected hashes.

Build the workspace, then run:

```text
node scripts/golden-backtest.mjs
node scripts/database-command.mjs test backtest-snapshot
```

The first command runs the frozen input check, golden unit cases and comparison tests. The second uses `vcp_test` to cover immutable restore, concurrent retries, atomic session rollback, stored reports and owner-scoped comparison. Synthetic PASS proofs only test gate behavior; they are not operational readiness evidence. No test data belongs in the production `vcp` database.

## Prepare chronological runs

Create independent pinned archives, detector runs and paper ledgers for training, validation and out-of-sample windows using the snapshot and paper-session commands. The archive's `from` and `through` define its evaluation window. Optional `historyFrom` may precede `from` to supply indicator warm-up; provide verified calendar, actions and raw revisions covering that history. Earlier rows are available to indicators but do not emit replay events or create paper fills before `from`. Rows predating a company's listing are excluded. The default without `historyFrom` remains `from`.

Use separate ledgers with pinned starting capital for each phase. Each phase needs enough actual closed episodes to support its reported statistics. Current replay supports the registered ST_VCP_4_0 configuration; this workflow does not enable unsupported strategy profiles or optimize parameters automatically.

## Compare stored runs

```text
node scripts/historical-snapshot.mjs walk-forward <plan.json>
```

The plan is an array of folds. Each fold contains `id` and `candidates`; each candidate contains `id`, `train`, `validation` and `outOfSample`. Every phase reference is `{ "runId": "stored-run-id", "asOf": "UTC-timestamp" }`. The cutoff must fall on that archive's `through` date. The command loads metrics from the authenticated owner's stored runs; performance numbers in a request cannot replace those records.

For every candidate, training must end before validation starts, and validation must end before out-of-sample starts. The code/configuration revision stays fixed across that candidate's phases. Candidates must use matching data revisions, windows and costs within each phase. Across successive folds, out-of-sample windows must be ordered and non-overlapping; training windows may expand.

Selection ranks only eligible training R expectancy, descending, with candidate ID as a deterministic tie breaker. Training requires configured costs, computed metrics and at least one closed trade. Validation and out-of-sample outcomes cannot change the chosen candidate. When training evidence is insufficient, the report explicitly selects nobody. Every output retains the selected and rejected candidates' phase report IDs, windows, P&L, expectancy, drawdown, bias and limitations. Changing a strategy after looking at validation or test results requires a new experiment, not a rewritten phase in this comparison.

These comparisons are reproducibility checks and research results. They do not establish live performance or fill guarantees; output performance verification remains false.
