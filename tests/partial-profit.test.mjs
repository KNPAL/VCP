import test from 'node:test';
import assert from 'node:assert/strict';
import {partialProfit} from '../packages/portfolio/dist/index.js';
const at='2026-10-21T06:00:00Z',stop={listingId:'listing',activeStop:'95',scaleRevision:'basis',effectiveAt:'2026-10-21T05:00:00Z'},quote={listingId:'listing',ltp:'110',sourceAt:at,receivedAt:at,session:'2026-10-21',quality:'FRESH',connection:'CONNECTED',validUntil:'2026-10-21T06:00:30Z'};
test('partial threshold is inclusive, uses initial risk and rounds a third down to lot',()=>{
 const run=(price,qty=10,lot=1)=>partialProfit('100',stop,{...quote,ltp:price},'basis',qty,lot,at);
 assert.equal(run('109.999999').state,'BELOW_2R');assert.equal(run('110').state,'PARTIAL_PROFIT');
 assert.equal(run('110').suggestedQuantity,3);assert.equal(run('111',20,3).suggestedQuantity,6);
 assert.equal(run('110',2).state,'LOT_TOO_SMALL');assert.equal(run('110',10,5).state,'LOT_TOO_SMALL');assert.equal(run('110',0).state,'CLOSED');
 assert.equal(run('110').executable,false);
});
test('partial trigger requires a current quote after stop recognition and unchanged scale',()=>{
 for(const q of [null,{...quote,sourceAt:'2026-10-21T04:59:59Z'},{...quote,sourceAt:'2026-10-21T06:00:01Z'},{...quote,validUntil:at},{...quote,connection:'DISCONNECTED'},{...quote,session:'2026-10-20'}])assert.equal(partialProfit('100',stop,q,'basis',10,1,at).state,'UNABLE_TO_EVALUATE');
 assert.equal(partialProfit('100',stop,quote,'changed',10,1,at).state,'UNABLE_TO_EVALUATE');
 assert.equal(partialProfit('95',stop,quote,'basis',10,1,at).state,'UNABLE_TO_EVALUATE');
});
