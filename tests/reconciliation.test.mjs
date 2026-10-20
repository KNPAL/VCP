import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcileStatement} from '../packages/portfolio/dist/index.js';
const at='2026-10-20T06:00:00Z',isin='INE000000001',base={occurredAt:at,recordedAt:at,sourceId:'fixture',author:'owner'};
const events=[{...base,id:randomUUID(),sequence:1,kind:'INITIAL_CAPITAL',amount:'1000',verified:true},{...base,id:randomUUID(),sequence:2,kind:'FILL',isin,side:'BUY',quantity:2,price:'100.123456',fees:'0.000001',brokerReference:'fill-1'}];
const statement={asOf:at,sourceReference:'statement-1',cash:'799.753087',holdings:[{isin,quantity:2}],fillReferences:['fill-1'],allOutsideActivityIncluded:true};
test('reconciliation compares all outside activity exactly without changing positions',()=>{
 assert.equal(reconcileStatement(events,statement,at).state,'RECONCILED_AS_OF');
 for(const changed of [{cash:'799.753088'},{holdings:[{isin,quantity:3}]},{fillReferences:['outside-fill']},{allOutsideActivityIncluded:false}])assert.equal(reconcileStatement(events,{...statement,...changed},at).state,'PORTFOLIO_UNRECONCILED');
 assert.equal(reconcileStatement(events,{...statement,holdings:[...statement.holdings,{isin:'INE000000002',quantity:1}]},at).quantities[0].statement,1);
 assert.equal(reconcileStatement(events,{...statement,asOf:'2026-10-19T06:00:00Z'},at).reasons.includes('STATEMENT_BEFORE_JOURNAL_ACTIVITY'),true);
 assert.throws(()=>reconcileStatement(events,{...statement,asOf:'2026-10-21T06:00:00Z'},at));
 assert.throws(()=>reconcileStatement(events,{...statement,holdings:[...statement.holdings,...statement.holdings]},at));
 assert.throws(()=>reconcileStatement(events,{...statement,fillReferences:['fill-1','fill-1']},at));
 assert.equal(reconcileStatement([],statement,at).state,'PORTFOLIO_UNRECONCILED');
 assert.equal(events.length,2);assert.equal(reconcileStatement(events,statement,at).executable,false);
});
