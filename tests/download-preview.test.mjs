import test from 'node:test';
import assert from 'node:assert/strict';
import {previewDownloadRange,dateAfter,calendarDays} from '../packages/market-data/dist/index.js';
const listingId='11111111-1111-4111-8111-111111111111';
function fixture(days=8){
 const dates=Array.from({length:days},(_,i)=>dateAfter('2025-01-01',i)),toDate=dates.at(-1),asOf=toDate+'T18:30:00Z';
 const calendar=dates.map((date,i)=>({date,kind:i===2?'HOLIDAY':'TRADING',opensAt:i===2?null:date+'T03:45:00Z',closesAt:i===2?null:date+'T10:00:00Z',finalizedAt:i===2?null:date+'T10:30:00Z',knownAt:'2024-12-01T00:00:00Z',source:'synthetic',verified:true}));
 const bars=calendar.filter(d=>d.kind!=='HOLIDAY').map(d=>({listingId,provider:'synthetic',session:d.date,open:'10',high:'11',low:'9',close:'10',volume:'100',zeroVolumeVerified:false,receivedAt:d.date+'T10:31:00Z',finalizedAt:d.finalizedAt}));
 return {fromDate:dates[0],toDate,asOf,listingId,provider:'synthetic',listingDate:dates[0],calendar,bars,providerFinalSession:toDate,interval:'1d',mode:'MISSING_ONLY'};
}
test('complete stored range makes no requests; holidays and listing dates are excluded',()=>{
 const input=fixture(),result=previewDownloadRange(input);assert.equal(result.missingCount,0);assert.equal(result.alreadyStoredCount,7);assert.deepEqual(result.rangesToFetch,[]);assert.equal(result.excludedDates[0].reason,'HOLIDAY');
 const listed=previewDownloadRange({...input,listingDate:'2025-01-04'});assert.equal(listed.alreadyStoredCount,5);assert.equal(listed.excludedDates[0].to,'2025-01-03');assert.equal(previewDownloadRange({...input,listingDate:'2026-01-01'}).state,'BLOCKED');
});
test('gaps and reconciliation use only finalized sessions; revised/cross-listing bars cannot mask gaps',()=>{
 const input=fixture(),bars=input.bars.filter(b=>b.session!=='2025-01-04'),result=previewDownloadRange({...input,bars});assert.deepEqual(result.missingSessions,['2025-01-04']);assert.deepEqual(result.rangesToFetch.flatMap(w=>w.sessions),['2025-01-04']);
 const reconcile=previewDownloadRange({...input,bars,mode:'RECONCILE'});assert.deepEqual(reconcile.reconcileSessions,['2025-01-06','2025-01-07','2025-01-08']);assert.equal(reconcile.missingCount,1);
 const invalid=previewDownloadRange({...input,bars:[...bars,{...input.bars[3],listingId:'22222222-2222-4222-8222-222222222222'}]});assert.deepEqual(invalid.missingSessions,['2025-01-04']);assert.equal(invalid.invalidCount,1);
 const conflict=previewDownloadRange({...input,bars:[...input.bars,{...input.bars[0],close:'10.5'}]});assert.deepEqual(conflict.missingSessions,['2025-01-01']);
 const early=previewDownloadRange({...input,asOf:input.toDate+'T10:15:00Z',providerFinalSession:null});assert.equal(early.state,'BLOCKED');assert.ok(!early.missingSessions.includes(input.toDate));assert.ok(early.excludedDates.some(d=>d.reason==='SESSION_NOT_FINALIZED'));
});
test('unknown calendars fail closed, bounded requests and strict range validation',()=>{
 const input=fixture(820),result=previewDownloadRange({...input,bars:[]});assert.ok(result.rangesToFetch.every(w=>calendarDays(w.from,w.to)<=400));assert.equal(result.missingCount,819);
 assert.equal(previewDownloadRange({...input,calendar:null}).state,'UNKNOWN');assert.equal(previewDownloadRange({...input,calendar:input.calendar.slice(1)}).state,'UNKNOWN');
 for(const change of [{listingId:'bad'},{provider:''},{interval:'1h'},{mode:'ALL'},{fromDate:'2025-02-30'},{fromDate:'2010-01-01'},{providerFinalSession:'2025-01-01'}])assert.throws(()=>previewDownloadRange({...input,...change}));
});
