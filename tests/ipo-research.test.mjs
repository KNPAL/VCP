import test from 'node:test';
import assert from 'node:assert/strict';
import {ipoResearch,validateIpoListing} from '../packages/strategy/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
const original=goldenSeries(),bars=original.bars.slice(-30),series={...original,bars,sessions:bars.map(b=>b.session),priceScale:'ADJUSTED'},metadata={listingId:'00000000-0000-4000-8000-000000000003',isin:'INE000000001',listingDate:bars[0].session,issuePrice:null,listingPrice:'100',knownAt:series.asOf,sourceReference:'synthetic-reviewed-source',permissionReference:'synthetic-test-only',verified:true};
test('IPO 29/30 boundary exposes confirmed structure only, never invented long history or BUY',()=>{
 const short={...series,bars:bars.slice(1),sessions:series.sessions.slice(1)};
 assert.equal(ipoResearch(metadata,short,series.asOf).state,'INSUFFICIENT_HISTORY');
 const result=ipoResearch(metadata,series,series.asOf);assert.equal(result.state,'STRUCTURE_OBSERVATION');assert.equal(result.completedBars,30);assert.equal(result.sma200,null);assert.equal(result.range252,null);assert.equal(result.rs250,null);assert.equal(result.metadata.issuePrice,null);assert.equal(result.buyEligible,false);assert.equal(result.executable,false);assert.equal(result.buyState,'BUY_BLOCKED');
 assert.ok(result.swings.every(s=>s.index<27&&s.confirmedAt<=series.asOf));assert.deepEqual(result,ipoResearch(metadata,series,series.asOf));
});
test('unverified, future, raw, prelisting and missing inputs cannot become research structure',()=>{
 assert.equal(ipoResearch({...metadata,verified:false},series,series.asOf).metadata,null);
 assert.equal(ipoResearch({...metadata,knownAt:'2099-01-01T00:00:00Z'},series,series.asOf).state,'UNKNOWN');
 assert.equal(ipoResearch(metadata,{...series,priceScale:'RAW'},series.asOf).state,'UNKNOWN');
 assert.equal(ipoResearch({...metadata,listingDate:bars[1].session},series,series.asOf).state,'UNKNOWN');
 assert.equal(ipoResearch(null,null,series.asOf).state,'UNKNOWN');
 assert.throws(()=>validateIpoListing({...metadata,issuePrice:'0'}),/INVALID_IPO_PRICE/);
 assert.throws(()=>validateIpoListing({...metadata,permissionReference:''}),/INVALID_IPO_SOURCE/);
 assert.equal(ipoResearch(metadata,{...series,bars:bars.map((b,i)=>i===29?{...b,finalizedAt:'2099-01-01T00:00:00Z'}:b)},series.asOf).state,'UNKNOWN');
});
