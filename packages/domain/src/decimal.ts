export class InputError extends Error {
  readonly code = 'INVALID_INPUT' as const;
}
/** Exact PostgreSQL NUMERIC value represented in integral fixed-scale units. */
export function parseFixed(value: string, scale = 6, precision = 20): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > precision || !Number.isInteger(precision) || precision > 38) throw new InputError('Invalid numeric format');
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > scale) throw new InputError('Invalid decimal string or excess precision');
  const units = BigInt((match[2] ?? '') + (match[3] ?? '').padEnd(scale, '0'));
  if (units >= 10n ** BigInt(precision)) throw new InputError('Numeric overflow');
  return match[1] ? -units : units;
}
export function formatFixed(units: bigint, scale = 6): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 38) throw new InputError('Invalid scale');
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return scale === 0 ? sign + digits : sign + digits.slice(0, -scale) + '.' + digits.slice(-scale);
}
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const left = parseFixed(a); const right = parseFixed(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function roundTick(price: string, tick: string, direction: 'UP' | 'DOWN'): string {
  const p = parseFixed(price); const t = parseFixed(tick);
  if (p < 0n || t <= 0n || !['UP', 'DOWN'].includes(direction)) throw new InputError('Invalid price, tick or rounding direction');
  return formatFixed((p / t + (direction === 'UP' && p % t !== 0n ? 1n : 0n)) * t);
}
export function integerShares(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InputError('Shares must be nonnegative safe integers');
  return value;
}
