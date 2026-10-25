import test from 'node:test';
import assert from 'node:assert/strict';
import {sellAlertSource} from '../packages/database/dist/index.js';
test('SELL source prices retain observation time rather than recognition and scheduled execution time',()=>{
 const sourceAt='2026-10-20T04:00:00Z',later='2026-10-21T04:00:00Z';
 assert.deepEqual(sellAlertSource({triggeredPrice:'90.123456',observedTickAt:sourceAt,recognizedAt:later}),{sourcePrice:'90.123456',sourceAt});
 assert.deepEqual(sellAlertSource({quote:{ltp:'120',sourceAt},recognizedAt:later}),{sourcePrice:'120',sourceAt});
 assert.deepEqual(sellAlertSource({input:{close:'105',closedAt:sourceAt},result:{effectiveAt:later}}),{sourcePrice:'105',sourceAt});
 assert.deepEqual(sellAlertSource({input:{sessions:[{date:'2026-10-19',close:'102',closedAt:later},{date:'2026-10-20',close:'101',closedAt:sourceAt}]},result:{triggerSession:'2026-10-20',effectiveAt:later}}),{sourcePrice:'101',sourceAt});
 assert.deepEqual(sellAlertSource({recognizedAt:later,result:{triggerSession:'missing'}}),{sourcePrice:null,sourceAt:null});
});
