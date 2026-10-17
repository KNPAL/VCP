export const STRATEGY_VERSION = "ST_VCP_4_0" as const;
export * from './decimal.js';
export * from './time.js';
export * from './contracts.js';
export type ReasonCode = "BLOCKED_DATA" | "BROKER_UNAVAILABLE" | "DATA_INCOMPLETE" | "INVALID_INPUT" | "NOT_IMPLEMENTED";
export type Known<T> = { state: "KNOWN"; value: T } | { state: "UNKNOWN"; reason: ReasonCode };
export type ApiError = { error: { code: ReasonCode; message: string; details: unknown; requestId: string }; at: string };
export type Page<T> = { items: T[]; nextCursor: string | null; asOf: string; dataRevision: string };
export function unknown(reason: ReasonCode = "BLOCKED_DATA"): Known<never> { return { state: "UNKNOWN", reason }; }
export function requireKnown<T>(input: Known<T>): T {
  if (input.state === "UNKNOWN") throw new Error(input.reason);
  return input.value;
}
