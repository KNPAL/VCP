import test from 'node:test';
import assert from 'node:assert/strict';
import {pinHistoricalSnapshot,historicalSlice} from '../packages/backtest/dist/index.js';
const listingId='11111111-1111-4111-8111-111111111111',isin='INE000000001',early='2026-10-20T11:00:00Z',late='2026-10-21T11:00:00Z',knownAt='2026-10-19T00:00:00Z';
function fixture(){return {
 from:'2026-10-20',through:'2026-10-21',knownAt:late,strategySha:'a'.repeat(40),strategyConfiguration:{version:4},seed:42,
 fees:{buyBps:'1',sellBps:'2',slippageBps:'3',minimumFee:'0',sourceReference:'synthetic-costs'},historicalDelistingsVerified:true,
 universes:[{id:'universe',universe:'NIFTY_500',knownAt,effectiveFrom:'2026-10-19',effectiveTo:null,sourceReference:'fixture',historicalConstituentsVerified:true,isins:[isin]}],
 instruments:[{id:'mapping',knownAt,sourceReference:'fixture',rows:[{companyId:listingId,isin,listingId,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'1',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]}],
 calendar:['2026-10-20','2026-10-21'].map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:05:00Z',knownAt,source:'fixture',verified:true})),
 actions:[{id:'actions-before',listingId,knownAt,verified:true,sourceReference:'fixture',coverageFrom:'2026-10-20',coverageThrough:'2026-10-21',actions:[]},{id:'actions-after',listingId,knownAt:late,verified:true,sourceReference:'fixture',coverageFrom:'2026-10-20',coverageThrough:'2026-10-21',actions:[{id:'split',listingId,kind:'SPLIT',effectiveAt:'2026-10-21T03:45:00Z',knownAt:late,sharesAfter:'2',sharesBefore:'1',verified:true,sourceReference:'fixture'}]}],
 raw:[{listingId,session:'2026-10-20',provider:'fixture',open:'100',high:'100',low:'100',close:'100',volume:'100',receivedAt:early,finalizedAt:'2026-10-20T10:05:00Z',zeroVolumeVerified:false,revisionId:'original',revision:1}]
}}
test('historical snapshot is detached, immutable, deterministic and survives serialization',()=>{
 const input=fixture(),snapshot=pinHistoricalSnapshot(input);input.fees.buyBps='500';
 assert.equal(snapshot.inputs.fees.buyBps,'1');assert.throws(()=>snapshot.inputs.raw.push({}),TypeError);
 assert.equal(snapshot.id,pinHistoricalSnapshot(fixture()).id);
 assert.deepEqual(historicalSlice(snapshot,early),historicalSlice(JSON.parse(JSON.stringify(snapshot)),early));
 assert.equal(snapshot.executable,false);assert.equal(snapshot.performanceVerified,false);
 const corrupt=JSON.parse(JSON.stringify(snapshot));corrupt.inputs.seed++;assert.throws(()=>historicalSlice(corrupt,early),/INTEGRITY/);
});
test('later corrections and corporate actions cannot change the earlier price scale',()=>{
 const input=fixture();input.raw.push({...input.raw[0],revisionId:'corrected',revision:2,receivedAt:late,open:'120',high:'120',low:'120',close:'120'});
 const snapshot=pinHistoricalSnapshot(input),before=historicalSlice(snapshot,early),after=historicalSlice(snapshot,late);
 assert.equal(before.selected[0].adjustment.bars[0].close,'100.000000');
 assert.equal(before.selected[0].adjustment.bars[0].rawRevisionId,'original');
 assert.equal(after.selected[0].adjustment.bars[0].close,'60.000000');
 assert.equal(after.selected[0].adjustment.bars[0].rawRevisionId,'corrected');
 assert.ok(after.reasons.some(reason=>reason.startsWith('DATA_GAP:')));
});
test('unknown universe, missing delistings and unavailable data stay explicit research limitations',()=>{
 const input=fixture();input.historicalDelistingsVerified=false;input.universes[0].historicalConstituentsVerified=false;
 const result=historicalSlice(pinHistoricalSnapshot(input),early);
 assert.equal(result.bias,'SURVIVORSHIP_BIASED_RESEARCH');assert.equal(result.performanceVerified,false);
 input.raw[0].receivedAt=late;
 assert.ok(historicalSlice(pinHistoricalSnapshot(input),early).reasons.some(reason=>reason.startsWith('RAW_HISTORY_MISSING:')));
});
test('future inputs, invalid costs and duplicate revisions are rejected',()=>{
 const input=fixture();input.raw.push({...input.raw[0]});assert.throws(()=>pinHistoricalSnapshot(input),/RAW_REVISION/);
 const costs=fixture();costs.fees.buyBps='-1';assert.throws(()=>pinHistoricalSnapshot(costs),/COST/);
 const future=fixture();future.actions[0].knownAt='2026-10-22T00:00:00Z';assert.throws(()=>pinHistoricalSnapshot(future),/FUTURE_INPUT/);
 assert.throws(()=>historicalSlice(pinHistoricalSnapshot(fixture()),'2026-10-22T00:00:00Z'),/OUTSIDE_SNAPSHOT/);
});
