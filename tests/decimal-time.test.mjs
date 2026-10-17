import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixed, formatFixed, roundTick, compareDecimal, integerShares, exchangeDate, completedSessions, utcInstant } from '../packages/domain/dist/index.js';
test('decimal arithmetic does not lose small units near maximum', () => {
  assert.equal(formatFixed(parseFixed('99999999999999.999998') + 1n), '99999999999999.999999');
  assert.equal(compareDecimal('0.10','0.100000'), 0);
});
test('reject overflow and malformed or overprecise financial inputs', () => {
  for (const value of ['100000000000000', '1e3', 'NaN', '1.0000001', ' 1', '.1']) assert.throws(() => parseFixed(value));
});
test('entry rounds up and protective stop down with exact tick boundaries', () => {
  assert.equal(roundTick('100.000001','0.05','UP'),'100.050000');
  assert.equal(roundTick('100.049999','0.05','DOWN'),'100.000000');
  assert.equal(roundTick('100.05','0.05','UP'),'100.050000');
  assert.throws(() => roundTick('1','0','DOWN'));
  assert.throws(() => roundTick('-1','0.05','UP'));
});
test('reject fractional and unsafe share quantities', () => {
  for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER+1, '1']) assert.throws(() => integerShares(value));
  assert.equal(integerShares(0),0);
});
test('IST date changes exactly at UTC 18:30', () => {
  assert.equal(exchangeDate('2026-10-16T18:29:59Z'),'2026-10-16');
  assert.equal(exchangeDate('2026-10-16T18:30:00Z'),'2026-10-17');
  assert.throws(() => utcInstant('2026-02-30T00:00:00Z'));
  assert.throws(() => utcInstant('2026-10-17T00:00:00+05:30'));
});
test('finalization, not calendar day, controls session availability', () => {
  const session = {date:'2026-10-16',opensAt:'2026-10-16T03:45:00Z',finalizedAt:'2026-10-16T10:30:00Z'};
  assert.deepEqual(completedSessions(null,session.opensAt),{state:'UNKNOWN',reason:'BLOCKED_DATA'});
  assert.equal(completedSessions([session],'2026-10-16T10:29:59Z').value.length,0);
  assert.equal(completedSessions([session],session.finalizedAt).value.length,1);
  assert.equal(completedSessions([{...session,finalizedAt:null}],session.finalizedAt).value.length,0);
  assert.throws(() => completedSessions([session,session],session.finalizedAt));
});
