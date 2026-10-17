# Breakout and manual-entry evidence

Shared strategy rules evaluate finalized t close against the frozen t−1 READY pivot before detector recomputation. Price cross is strict (today > pivot, prior close <= pivot); prior-volume RVOL uses exactly 50 preceding completed sessions and confirms at >=1.50. Missing calendar, late finalization, zero volume baseline or future evidence produces UNKNOWN. The helper persists any market event before invoking detector recomputation.

Immutable market records distinguish BREAKOUT_CONFIRMED from BREAKOUT_PRICE_ONLY and retain source revisions, frozen snapshot, exact volume ratio, timestamps, configuration hash and data revision. Correction revisions preserve earlier events. Separate user decisions may block a confirmed signal without modifying it.

The entry evaluator requires one of the next two verified exchange sessions, continuous trading, quote age <=60 seconds, heartbeat <=30 seconds, valid settled broker/session/token, G04/G05/G06/G08 PASS, every required portfolio gate PASS and GREEN/YELLOW regime. Quote must be strictly above pivot and <=1.03 times pivot. The structural stop is last confirmed low minus one tick, rounded down; risk wider than 8% blocks the plan rather than tightening the stop. Decision expiry is 30 seconds. Actual fills are recorded separately.

Configuration revision ST_VCP_4_0_CONFIG_2 separates the 60-second quote, 30-second heartbeat and 30-second plan limits. The earlier configuration incorrectly named the 30-second limit as quote freshness. Its immutable records remain retained; new records use a new configuration hash/version while the normative strategy remains ST_VCP_4_0. No historical record is rewritten.

Unit tests cover exact boundaries, missing/future input, same-day rejection, expiry, order of persistence/recompute and independent portfolio blocking. PostgreSQL tests cover retry conflicts, append-only user decisions, retained market corrections and foreign-key linkage. Live quote fetching, transactional risk snapshots, end-to-end scan handlers and reevaluation endpoints remain unfinished (KAN-80/82/84/86); pure eligibility output alone is not a working live trading workflow.
