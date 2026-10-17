import test from 'node:test';
import assert from 'node:assert/strict';
import {completeScan,candidatePage} from '../packages/strategy/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const evidence={scanId:id(10),asOf:'2026-01-01T12:00:00Z',configHash:'a'.repeat(64),dataRevision:'r1'};
const outcome=n=>({instrumentId:id(n),status:'ANALYZED',reasons:[],candidate:{instrumentId:id(n),marketState:'READY',rsPercentile:'85',legs:3,finalDepth:'0.05',vdu:'0.7',pivot:'100',close:'99',adv20Median:'250000000',reasons:[]}});
test('coverage includes missing and excluded listings without claiming full success',()=>{
 const scan=completeScan(evidence,[id(1),id(2),id(3)],[outcome(1),{instrumentId:id(3),status:'EXCLUDED',reasons:['NOT_ELIGIBLE'],candidate:null}]);
 assert.equal(scan.status,'PARTIAL');assert.deepEqual(scan.counts,{intended:3,eligible:2,analyzed:1,rejected:0,missing:1,excluded:1});
 assert.deepEqual(scan.entries[1].reasons,['NOT_PROCESSED']);
 assert.equal(completeScan(evidence,[id(1)],[]).status,'ERROR');
 assert.equal(completeScan(evidence,[id(1)],[outcome(1)]).status,'COMPLETE');
 assert.throws(()=>completeScan(evidence,[id(1)],[outcome(2)]));
 assert.throws(()=>completeScan(evidence,[id(1)],[outcome(1),outcome(1)]));
});
test('stable pages bind to immutable scan and filters, rejecting cross-scan cursors',()=>{
 const scan=completeScan(evidence,[id(1),id(2),id(3)],[outcome(3),outcome(1),outcome(2)]);
 const first=candidatePage(scan,{limit:1});assert.equal(first.items[0].instrumentId,id(1));
 const second=candidatePage(scan,{limit:1,cursor:first.nextCursor});assert.equal(second.items[0].instrumentId,id(2));
 assert.equal(candidatePage(scan,{cursor:second.nextCursor}).nextCursor,null);
 assert.throws(()=>candidatePage({...scan,scanId:id(20)},{cursor:first.nextCursor}),/CURSOR/);
 assert.throws(()=>candidatePage(scan,{cursor:first.nextCursor,state:'READY'}),/CURSOR/);
 assert.throws(()=>candidatePage(scan,{state:'UNKNOWN_NEW_STATE'}),/STATE/);
 assert.throws(()=>candidatePage(scan,{limit:0}),/LIMIT/);
 assert.throws(()=>candidatePage(scan,{sort:'price'}),/SORT/);
 assert.equal(candidatePage(scan,{state:'BLOCKED_DATA'}).items.length,0);
});
