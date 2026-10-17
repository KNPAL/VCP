import { InputError } from './decimal.js';
import type { Known } from './index.js';
export type EvidenceTime = { asOf: string; decidedAt: string; eligibleFrom: string };
export type TradingSession = { date: string; opensAt: string; finalizedAt: string | null };
export type BarProvenance = { start: string; end: string; session: string; source: string; receivedAt: string; final: boolean; revision: string };
export function utcInstant(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new InputError('UTC ISO timestamp required');
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value.replace(/(?<=:\d{2})Z$/, '.000Z')) throw new InputError('Invalid timestamp');
  return date;
}
export function exchangeDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(utcInstant(value));
}
/** Calendar must come from verified exchange data; never infer holidays from weekdays. */
export function completedSessions(sessions: readonly TradingSession[] | null, asOf: string): Known<readonly TradingSession[]> {
  const cutoff = utcInstant(asOf).valueOf();
  if (sessions === null) return { state: 'UNKNOWN', reason: 'BLOCKED_DATA' };
  const seen = new Set<string>();
  for (const session of sessions) {
    const open = utcInstant(session.opensAt);
    if (exchangeDate(session.opensAt) !== session.date || seen.has(session.date)) throw new InputError('Invalid or duplicate session');
    seen.add(session.date);
    if (session.finalizedAt !== null && utcInstant(session.finalizedAt) <= open) throw new InputError('Finalization must follow open');
  }
  return { state: 'KNOWN', value: sessions.filter(s => s.finalizedAt !== null && utcInstant(s.finalizedAt).valueOf() <= cutoff).sort((a,b) => a.date.localeCompare(b.date)) };
}
