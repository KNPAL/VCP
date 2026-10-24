import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateDailyExit} from '../packages/backtest/dist/index.js';
function fixture(){const date='2026-10-20',listingId='00000000-0000-4000-8000-000000000001',asOf=date+'T11:00:00Z';return {
 snapshotId:'snapshot',strategyRevision:'strategy',dataRevision:'data',asOf,
 position:{id:'position',listingId,quantity:9,entry:'100',initialStop:'90',activeStop:'90',scaleSession:'2026-10-19',stopEffectiveAt:date+'T03:45:00Z',partialTaken:false},
 bar:{listingId,session:date,provider:'synthetic',open:'100',high:'130',low:'89',close:'110',volume:'1000',receivedAt:asOf,finalizedAt:date+'T10:05:00Z',zeroVolumeVerified:false,revisionId:'raw'},
 calendar:{date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:05:00Z',knownAt:'2026-10-19T00:00:00Z',source:'synthetic',verified:true},
 actions:{id:'actions',listingId,knownAt:'2026-10-19T00:00:00Z',verified:true,sourceReference:'synthetic',coverageFrom:'2026-10-19',coverageThrough:date,actions:[]},tick:'0.05',lotSize:1,liquidity:'TRADABLE',scheduledSell:null,fees:{buyBps:'10',sellBps:'10',slippageBps:'10',minimumFee:'1',sourceReference:'synthetic'},bias:null};}
test('same-bar stop/target ambiguity takes the whole protective stop before profit or prior EOD sell',()=>{
 const input=fixture();input.scheduledSell={id:'scheduled',knownAt:'2026-10-19T11:00:00Z',quantity:9};
 const result=simulateDailyExit(input);assert.equal(result.kind,'PROTECTIVE_STOP');assert.equal(result.quantity,9);assert.equal(result.ambiguousStopAndTarget,true);assert.equal(result.fill.price,'89.900000');assert.equal(result.executable,false);
 assert.deepEqual(result,simulateDailyExit(structuredClone(input)));
 input.position.scaleSession=input.bar.session;assert.equal(simulateDailyExit(input).kind,'PROTECTIVE_STOP');
});
test('overnight gap uses open, scheduled sells use open and target-only sale uses one third',()=>{
 const gap=fixture();gap.bar.open='85';gap.bar.low='80';assert.equal(simulateDailyExit(gap).kind,'PROTECTIVE_GAP');assert.equal(simulateDailyExit(gap).fill.price,'84.900000');
 const target=fixture();target.bar.low='95';const partial=simulateDailyExit(target);assert.equal(partial.kind,'PARTIAL_2R');assert.equal(partial.quantity,3);assert.equal(partial.fill.price,'119.850000');
 target.scheduledSell={id:'scheduled',knownAt:'2026-10-19T11:00:00Z',quantity:9};assert.equal(simulateDailyExit(target).kind,'PRIOR_EOD_SELL');assert.equal(simulateDailyExit(target).fill.price,'99.900000');
 target.scheduledSell=null;target.position.partialTaken=true;assert.equal(simulateDailyExit(target).state,'NO_EXIT');
});
test('corporate actions adjust quantity and stops before any protective comparisons',()=>{
 const input=fixture();input.actions.actions=[{id:'split',listingId:input.position.listingId,kind:'SPLIT',effectiveAt:input.calendar.opensAt,knownAt:input.actions.knownAt,sharesAfter:'2',sharesBefore:'1',verified:true,sourceReference:'synthetic'}];
 input.bar={...input.bar,open:'50',high:'65',low:'44',close:'55'};
 const result=simulateDailyExit(input);assert.equal(result.quantity,18);assert.equal(result.adjusted.activeStop,'45.000000');assert.equal(result.fill.price,'44.950000');
 input.position.quantity=1;input.actions.actions[0].sharesBefore='3';assert.ok(simulateDailyExit(input).reasons.includes('FRACTIONAL_SHARE_ENTITLEMENT_UNKNOWN'));
});
test('price locks, unknown liquidity, missing actions, no trading and future data cannot guarantee exits',()=>{
 for(const change of [x=>x.liquidity='PRICE_LIMIT_LOCKED',x=>x.liquidity='UNKNOWN',x=>x.actions=null,x=>x.calendar.kind='HOLIDAY',x=>x.bar.receivedAt='2026-10-21T11:00:00Z',x=>{x.bar.volume='0';x.bar.zeroVolumeVerified=true},x=>x.position.stopEffectiveAt='2026-10-21T03:45:00Z']){
  const input=fixture();change(input);const result=simulateDailyExit(input);assert.equal(result.state,'UNABLE_TO_SIMULATE');assert.equal(result.quantity,0);assert.equal(result.fill,null);
 }
});
