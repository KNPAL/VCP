import test from 'node:test';
import assert from 'node:assert/strict';
import {momentumProxyResearch} from '../packages/strategy/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
const source=goldenSeries(),bars=source.bars.slice(-101).map(b=>({...b,open:'99',high:'100',low:'98',close:'99',volume:'100'})),asOf=source.asOf,proof={sourceReference:'synthetic',permissionReference:'synthetic-license',knownAt:asOf,validUntil:'2026-12-01T00:00:00Z',verified:true,displayAllowed:true,deriveAllowed:true};
function run(close='101',volume='101',edit={},p=proof){const series={...source,bars:bars.map((b,i)=>i===100?{...b,open:close,high:close,low:'98',close,volume}:b),sessions:bars.map(b=>b.session),...edit};return momentumProxyResearch(series,p,asOf)}
test('100-day comparator excludes current high/volume and uses strict greater-than boundaries',()=>{
 const result=run();assert.equal(result.state,'MOMENTUM_PROXY_BREAKOUT');assert.equal(result.prior100High,'100.000000');assert.equal(result.rvol20Prev,'1.010000');assert.equal(result.buyEligible,false);assert.equal(result.executable,false);assert.equal(result.structuralVcp,false);assert.equal(result.broaderProxy.state,'UNKNOWN');
 assert.equal(run('100').state,'NO_PROXY_BREAKOUT');assert.equal(run('101','100').state,'NO_PROXY_BREAKOUT');assert.equal(run('101','100.00000001').state,'MOMENTUM_PROXY_BREAKOUT');
 assert.equal(run('101','101',{bars:bars.slice(1),sessions:bars.slice(1).map(b=>b.session)}).state,'UNKNOWN');
 assert.equal(run('101','101',{bars:bars.map(b=>({...b,volume:'0'}))}).state,'UNKNOWN');
});
test('proxy missing, denied, expired, raw and incomplete source evidence stays UNKNOWN',()=>{
 for(const p of [null,{...proof,verified:false},{...proof,deriveAllowed:false},{...proof,displayAllowed:null},{...proof,permissionReference:''},{...proof,validUntil:asOf},{...proof,knownAt:'2026-11-01T00:00:00Z'}]){const result=run('101','101',{},p);assert.equal(result.state,'UNKNOWN');assert.equal(result.prior100High,null);assert.equal(result.buyEligible,false)}
 for(const change of [{priceScale:'RAW'},{sessions:[]},{asOf:'2026-11-01T00:00:00Z'},{bars:bars.map(b=>({...b,adjustmentVerified:false}))}])assert.equal(run('101','101',change).state,'UNKNOWN');
 assert.equal(momentumProxyResearch(null,proof,asOf).state,'UNKNOWN');
});
