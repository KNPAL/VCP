import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCandidates,MARKET_STATE_ORDER} from '../packages/strategy/dist/index.js';
const evidence={scanId:'scan-1',asOf:'2026-01-01T12:00:00.000Z',dataRevision:'revision-1',configHash:'a'.repeat(64)};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n,overrides={})=>({instrumentId:id(n),marketState:'READY',rsPercentile:'85',legs:3,finalDepth:'0.05',vdu:'0.7',pivot:'100',close:'99',adv20Median:'250000000',reasons:[],...overrides});
const order=rows=>rankCandidates(rows,evidence).map(x=>x.instrumentId);
test('state always precedes numeric rank and unknowns stay visible',()=>{
 const rows=MARKET_STATE_ORDER.map((marketState,i)=>row(i,{marketState,rsPercentile:i===0?null:'100'}));
 assert.deepEqual(order(rows.toReversed()),rows.map(x=>x.instrumentId));
 assert.equal(rankCandidates(rows,evidence).length,6);
});
test('each rank dimension breaks ties in the documented direction',()=>{
 for(const overrides of [{rsPercentile:'86'},{legs:4},{finalDepth:'0.04'},{vdu:'0.6'},{close:'99.5'},{adv20Median:'260000000'}])
  assert.deepEqual(order([row(1),row(2,overrides)]),[id(2),id(1)]);
 assert.deepEqual(order([row(2),row(1)]),[id(1),id(2)]);
 for(const field of ['rsPercentile','finalDepth','vdu','pivot','close','adv20Median'])
  assert.deepEqual(order([row(1,{[field]:null}),row(2)]),[id(2),id(1)]);
});
test('exact fractional proximity avoids rounded ties and clamps closes above pivot',()=>{
 assert.deepEqual(order([row(1,{pivot:'9999999999',close:'9999999998'}),row(2,{pivot:'9999999998',close:'9999999997.1'})]),[id(2),id(1)]);
 assert.deepEqual(order([row(1,{close:'100'}),row(2,{close:'101'})]),[id(1),id(2)]);
});
test('retries preserve rank, evidence and input; malformed or duplicate rows fail closed',()=>{
 const rows=[row(2),row(1)];const before=structuredClone(rows);
 const first=rankCandidates(rows,evidence);
 assert.deepEqual(first,rankCandidates(rows.toReversed(),evidence));assert.deepEqual(rows,before);
 assert.equal(first[0].rank,1);assert.equal(first[0].configHash,evidence.configHash);
 assert.deepEqual(first[0].rankTuple[5],{numerator:'100000000',denominator:'10000000000'});
 for(const overrides of [{marketState:'NEW'},{legs:7},{rsPercentile:'101'},{vdu:'-1'},{pivot:'0'},{instrumentId:'bad'}])assert.throws(()=>order([row(1,overrides)]));
 assert.throws(()=>order([row(1),row(1)]),/DUPLICATE/);
 assert.throws(()=>rankCandidates(rows,{...evidence,configHash:'bad'}),/EVIDENCE/);
});
