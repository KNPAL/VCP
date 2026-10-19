import test from 'node:test';
import assert from 'node:assert/strict';
import {replayStructure,evaluateBreakout,ST_VCP_4_0,configurationHash} from '../packages/strategy/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
import {breakoutInput} from '../fixtures/signal-golden.mjs';
function input(){const series=goldenSeries();const session=new Date(new Date(series.bars.at(-1).session).valueOf()+86400000).toISOString().slice(0,10);series.bars.push({session,open:'101',high:'102',low:'100',close:'101',volume:'200',revision:'breakout',endedAt:session+'T10:00:00Z',finalizedAt:session+'T10:30:00Z',adjustmentVerified:true});series.sessions.push(session);series.asOf=series.bars.at(-1).finalizedAt;return {listingId:'00000000-0000-4000-8000-000000000001',series,tick:'0.05',adjustmentRevision:'synthetic-adjustment',configHash:configurationHash(ST_VCP_4_0),decidedAt:'2026-10-18T00:00:00Z',strength:Object.fromEntries(series.bars.map(b=>[b.session,{value:'85',revision:'synthetic-rs-'+b.session,knownAt:b.finalizedAt}]))}}
test('chronological replay uses yesterday frozen pivot before current VCP recomputation',()=>{
 const source=input();for(const strength of Object.values(source.strength))strength.value='85.00000000';
 const before=structuredClone(source),result=replayStructure(source),last=result.at(-1);
 assert.equal(result.at(-2).structure.primary.state,'READY');assert.equal(last.breakout.state,'BREAKOUT_CONFIRMED');assert.equal(last.breakout.event.pivot,'100.000000');
 assert.ok(last.structure.patterns.some(p=>p.pivot==='102.000000'));
 assert.deepEqual(source,before);
 const prefix={...source,series:{...source.series,bars:source.series.bars.slice(0,-1),sessions:source.series.sessions.slice(0,-1),asOf:source.series.bars.at(-2).finalizedAt}};
 assert.deepEqual(replayStructure(prefix),result.slice(0,-1));
});
test('absent or future-known RS cannot reconstruct a passing READY state',()=>{
 const source=input();source.series.bars=source.series.bars.slice(-8);source.series.sessions=source.series.sessions.slice(-8);
 for(const strength of [{},Object.fromEntries(source.series.bars.map(b=>[b.session,{value:'85',revision:'future',knownAt:'2027-01-01T00:00:00Z'}]))]){
  const result=replayStructure({...source,strength});assert.ok(result.every(row=>row.rs.state==='UNKNOWN'&&row.breakout.event===null));
 }
 assert.throws(()=>replayStructure({...source,series:{...source.series,asOf:'2023-01-01T00:00:00Z'}}),/REPLAY_UNFINALIZED_SERIES/);
});
test('adjusted fractional share volume retains exact RVOL boundaries and raw remains integer-only',()=>{
 const source=breakoutInput();source.today.volume='0.00000003';source.priorBars=source.priorBars.map(b=>({...b,volume:'0.00000002'}));
 assert.throws(()=>evaluateBreakout(source),/INVALID_VOLUME/);
 assert.equal(evaluateBreakout({...source,volumeScale:'ADJUSTED'}).state,'BREAKOUT_CONFIRMED');
 assert.equal(evaluateBreakout({...source,today:{...source.today,volume:'0.00000002'},volumeScale:'ADJUSTED'}).state,'BREAKOUT_PRICE_ONLY');
});
