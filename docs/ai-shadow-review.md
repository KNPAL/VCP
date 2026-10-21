# Post-V1 AI shadow review (KAN-139)

AI is outside mandatory V1 and disabled in the application. There is no model client, credential requirement, worker job, public API endpoint or decision-path dependency. An internal offline audit sink is available for contract validation. `shadowReview` is an offline, versioned contract validator for future evaluation; it performs no network or storage operations. This does not implement the remaining protective-monitoring tickets.

## Authority and inputs

Only SHADOW or ADVISORY evaluation is permitted. PASS, VETO, REVIEW_REQUIRED and UNAVAILABLE are observations, never approval or execution instructions. Even VETO cannot stop protective monitoring. The deterministic BUY, SELL, market, stop, position and portfolio gates remain authoritative for every outcome. Do not merge a shadow result into a signal, risk snapshot, actual-fill command or order payload.

Inputs must reference immutable, timestamped deterministic VCP contractions, local RS, volume, structural pivots, portfolio risk and source-quality evidence. The offline contract retains a revision and timestamp for each of these six categories. Missing, duplicate, future or UNKNOWN evidence yields UNAVAILABLE. VERIFIED is an upstream evidence assertion, not something a model can supply; a future adapter must resolve every revision against authorized stored evidence before calling the validator. Freshness and source permissions must also be evaluated by the authoritative source gates. Model output cannot certify them.

AI must never invent prices, compute proprietary RS ratings, change pivots, bypass hard gates, alter actual fills, or place/cancel orders. No licensed data may be sent to an external service without capability and data-use approval.

## Response and audit contract

The accepted response has exactly `version`, `at` (UTC milliseconds) and `outcome`. Unknown keys, invalid enums, future timestamps and responses predating their input evidence yield UNAVAILABLE/INVALID_RESPONSE. Absent responses yield UNAVAILABLE/SERVICE_UNAVAILABLE. Disabled evaluation yields UNAVAILABLE/AI_DISABLED. A result always carries `authoritative: false`.

Every returned audit record includes AI_SHADOW_1 contract version, strategy/model/prompt versions, evaluation timestamp, all input evidence references, accepted response version/timestamp, outcome and reason. Migration 38 provides an append-only ShadowReviewAudit table and internal recordShadowAudit/readShadowAudits functions, separate from scanner history. Owner-scoped retries preserve the original record and reject changed payloads. Invalid context is logged as UNAVAILABLE with a request digest; arbitrary model text is never stored. Log unavailable and invalid evaluations with these source references, not raw provider text, credentials or prompts. Malformed context/evidence throws a contract error; a future adapter must record a rejected-input audit and keep deterministic monitoring running. Never convert exceptions or audit-write failures into PASS.

There is deliberately no model evaluation service in V1. The audit sink accepts offline contract inputs; it does not certify their provenance or authorize external data transmission. A future adapter must add bounded provider timeouts and retries, source-license and reference-resolution checks, an isolated queue, response-size limits and fail-open-to-deterministic-monitoring behavior. Model/prompt versions must identify retained immutable artifacts; a mutable provider alias alone is insufficient. Untrusted response text is not an executable instruction.

## Release gate and verification

Tests cover all four outcomes in both modes, disabled operation, unavailable/invalid responses, source gaps, unknown quality, chronology, duplicate evidence and input immutability. Existing deterministic tests run without an AI service or key. The validator exposes no decision mutation or execution capability.

Before any future adapter ships, test a blocked BUY plus AI PASS, a protective SELL plus AI VETO, provider timeout, invalid output and failed audit writes against the completed live monitoring pipeline. All must preserve deterministic behavior. Protective-stop integration now covers AI VETO, unavailable response and rejected audit writes while preserving the actual gap-triggered SELL and unchanged holdings. The offline validator separately proves AI PASS cannot clear an unreconciled BUY block. Provider timeouts remain a requirement for a future provider adapter; no provider is enabled. Any expansion beyond nonauthoritative review requires a NEW strategy version, independent evaluation and external capability approvals.

