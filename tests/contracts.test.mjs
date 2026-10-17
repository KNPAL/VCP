import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wireDecimal,wireTimestamp,sessionDate,enumValue,SignalStates,errorCodes} from '../packages/domain/dist/index.js';
test('wire contracts reject numeric money and invalid dates and states',()=>{
 assert.equal(wireDecimal('1.000001'),'1.000001');
 for(const v of [1,null,'NaN','1e6','1.0000001'])assert.throws(()=>wireDecimal(v));
 assert.equal(wireTimestamp('2026-10-17T00:00:00Z'),'2026-10-17T00:00:00Z');
 assert.throws(()=>wireTimestamp('2026-10-17'));
 assert.equal(sessionDate('2024-02-29'),'2024-02-29');assert.throws(()=>sessionDate('2025-02-29'));
 assert.throws(()=>enumValue(SignalStates,'AUTO_BUY'));assert.equal(enumValue(SignalStates,'BUY_BLOCKED'),'BUY_BLOCKED');
 assert.equal(errorCodes[409],'STALE_CONFLICT');assert.equal(errorCodes[503],'BROKER_UNAVAILABLE');
});
