import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyBreakout,detectDailyStructure,configurationHash,ST_VCP_4_0} from '../packages/strategy/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
function fixture(){
 const series={...goldenSeries(),priceScale:'ADJUSTED'};
 return {listingId:'00000000-0000-4000-8000-000000000003',series,tick:'0.05',adjustmentRevision:'a1',scaleRevision:'no-actions',configHash:configurationHash(ST_VCP_4_0),decidedAt:series.asOf,strength:{value:'85',revision:'rs1',knownAt:series.asOf}};
}
function next(input){
 const copy=structuredClone(input),prior=copy.series.bars.at(-1),session=new Date(Date.parse(prior.session)+86400000).toISOString().slice(0,10);
 copy.series.bars.push({...prior,session,open:'101',high:'102',low:'100',close:'101',volume:'200',revision:'new',endedAt:session+'T10:00:00Z',finalizedAt:session+'T10:30:00Z'});
 copy.series.sessions.push(session);copy.series.asOf=copy.series.bars.at(-1).finalizedAt;copy.series.dataRevision='next';copy.decidedAt=copy.series.asOf;
 return copy;
}
test('daily path consumes frozen primary even when today raises its own pivot',()=>{
 const input=fixture(),frozen=detectDailyStructure(input).frozen;
 assert.equal(frozen.primary.state,'READY');assert.equal(frozen.primary.pivot,'100.000000');
 const current=next(input),original=structuredClone(frozen);
 assert.equal(dailyBreakout(current,frozen).state,'BREAKOUT_CONFIRMED');
 assert.equal(detectDailyStructure(current).structure.primary.pivot,'102.000000');
 assert.deepEqual(frozen,original);
});
test('missing prior, scale changes, wrong session and late reconstruction cannot confirm',()=>{
 const input=fixture(),frozen=detectDailyStructure(input).frozen,current=next(input);
 assert.equal(dailyBreakout(current,null).state,'UNKNOWN');
 for(const change of [{scaleRevision:'split'},{session:current.series.sessions.at(-1)},{decidedAt:current.decidedAt},{configHash:'b'.repeat(64)},{listingId:'foreign'}]){
  assert.equal(dailyBreakout(current,{...frozen,...change}).state,'UNKNOWN');
 }
});
test('unknown or future RS cannot fabricate READY; invalid strength is rejected',()=>{
 const input=fixture();input.strength.knownAt='2099-01-01T00:00:00Z';
 const result=detectDailyStructure(input);assert.equal(result.rs.state,'UNKNOWN');assert.notEqual(result.frozen.primary?.state,'READY');
 input.strength.value='101';assert.throws(()=>detectDailyStructure(input),/INVALID_DAILY_STRENGTH/);
});
test('daily market confirmation waits for finalization and accepts adjusted fractional volume',()=>{
 const input=fixture(),frozen=detectDailyStructure(input).frozen,current=next(input);
 current.series.bars.at(-1).volume='200.12345678';assert.equal(dailyBreakout(current,frozen).state,'BREAKOUT_CONFIRMED');
 current.series.bars.at(-1).finalizedAt=null;assert.equal(dailyBreakout(current,frozen).state,'UNKNOWN');
});
