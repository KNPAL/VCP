import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknown, requireKnown, STRATEGY_VERSION } from '../packages/domain/dist/index.js';
test('strategy contract uses v4', () => assert.equal(STRATEGY_VERSION, 'ST_VCP_4_0'));
test('missing input fails closed', () => assert.throws(() => requireKnown(unknown()), /BLOCKED_DATA/));
test('broker unavailability preserves reason', () => assert.throws(() => requireKnown(unknown('BROKER_UNAVAILABLE')), /BROKER_UNAVAILABLE/));
test('known zero is not treated as missing', () => assert.equal(requireKnown({state:'KNOWN', value:0}), 0));
test('known empty collections remain known', () => assert.deepEqual(requireKnown({state:'KNOWN', value:[]}), []));
