import test from 'node:test';
import assert from 'node:assert/strict';
import {planSynchronization,synchronizeCandles,inspectCandleBatch} from '../packages/market-data/dist/index.js';
const dates=Array.from({length:10},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
const calendar=dates.map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic',verified:true}));
const input={listingId:'00000000-0000-4000-8000-000000000001',provider:'synthetic',from:dates[0],to:dates.at(-1),asOf:'2026-10-10T12:00:00Z',calendar,storedSessions:dates};
const bar=session=>({listingId:input.listingId,provider:input.provider,session,open:'100',high:'110',low:'99',close:'105',volume:'1000',receivedAt:input.asOf,finalizedAt:session+'T10:30:00Z',zeroVolumeVerified:false});

test('large missing intervals are bounded to 400 calendar days per request',()=>{
 const days=Array.from({length:805},(_,i)=>new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10));
 const calendar=days.map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2023-01-01T00:00:00Z',source:'synthetic',verified:true}));
 const plan=planSynchronization({...input,from:days[0],to:days.at(-1),calendar,storedSessions:[],asOf:'2026-10-18T12:00:00Z'});
 assert.deepEqual(plan.ranges.map(r=>r.sessions.length),[400,400,5]);assert.deepEqual(plan.ranges.flatMap(r=>r.sessions),days);
});

test('synchronization fetches exactly three final sessions and separately fills older gaps',()=>{
 assert.deepEqual(planSynchronization(input).ranges,[{from:dates[7],to:dates[9],sessions:dates.slice(7)}]);
 const gaps=planSynchronization({...input,storedSessions:dates.filter((_,i)=>i!==1&&i!==4)});
 assert.deepEqual(gaps.missing,[dates[1],dates[4]]);assert.equal(gaps.ranges.length,3);
 assert.equal(planSynchronization({...input,storedSessions:[]}).ranges.length,1);
});

test('verified holidays, special sessions, late finalization and unknown calendars govern the overlap',()=>{
 const changed=calendar.map(day=>day.date===dates[8]?{...day,kind:'HOLIDAY',opensAt:null,closesAt:null,finalizedAt:null}:day.date===dates[9]?{...day,kind:'SPECIAL'}:day);
 assert.deepEqual(planSynchronization({...input,calendar:changed}).overlap,[dates[6],dates[7],dates[9]]);
 assert.deepEqual(planSynchronization({...input,asOf:'2026-10-10T10:15:00Z'}).overlap,dates.slice(6,9));
 assert.equal(planSynchronization({...input,calendar:calendar.slice(1)}).state,'UNKNOWN');
});

test('broker failure on a later range commits nothing; scope mismatch also fails closed',async()=>{
 let commits=0,requests=0;
 const deps={fetch:async range=>{if(++requests===2)throw new Error('secret broker response');return range.sessions.map(bar)},now:()=>input.asOf,commit:async()=>{commits++}};
 const result=await synchronizeCandles({...input,storedSessions:dates.slice(1)},deps);
 assert.equal(result.reason,'BROKER_FETCH_FAILED');assert.equal(commits,0);assert.ok(!JSON.stringify(result).includes('secret'));
 assert.equal((await synchronizeCandles(input,{...deps,fetch:async()=>[bar(dates[0])]})).reason,'BROKER_RESPONSE_SCOPE_MISMATCH');assert.equal(commits,0);
});

test('truncated overlap stays incomplete and stored historical sessions are not false response gaps',async()=>{
 const deps={fetch:async range=>range.sessions.map(bar),now:()=>input.asOf,commit:async batch=>inspectCandleBatch(batch)};
 const complete=await synchronizeCandles(input,deps);assert.equal(complete.report.state,'COMPLETE');assert.equal(complete.report.expectedCount,3);
 const truncated=await synchronizeCandles(input,{...deps,fetch:async range=>range.sessions.slice(0,-1).map(bar)});
 assert.deepEqual(truncated.report.missing,[{session:dates[9],reason:'DATA_INCOMPLETE'}]);
 assert.equal(truncated.report.actualCount,2);
});

test('unknown and not-yet-final sessions cause no broker request and regressed clocks cannot commit',async()=>{
 let calls=0;const deps={fetch:async range=>{calls++;return range.sessions.map(bar)},now:()=> '2026-10-09T12:00:00Z',commit:async()=>assert.fail('must not commit')};
 assert.equal((await synchronizeCandles({...input,calendar:null},deps)).state,'UNKNOWN');
 assert.equal((await synchronizeCandles({...input,asOf:'2026-10-01T10:15:00Z'},deps)).state,'IDLE');assert.equal(calls,0);
 await assert.rejects(synchronizeCandles(input,deps),/SYNC_CLOCK_REGRESSION/);
});
