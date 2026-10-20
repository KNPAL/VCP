import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarScheduleDecision} from '../packages/database/dist/index.js';
import {dispatchScheduledScans,scheduledScanHandler} from '../apps/worker/dist/scheduler.js';
const day={date:'2026-10-19',kind:'SPECIAL',opensAt:'2026-10-19T03:45:00Z',closesAt:'2026-10-19T10:00:00Z',finalizedAt:'2026-10-19T10:30:00Z',knownAt:'2026-10-18T00:00:00Z',source:'synthetic',verified:true};
test('scheduler uses verified session finalization rather than close or weekdays',()=>{
 assert.equal(calendarScheduleDecision([day],'2026-10-19T10:29:59.999Z').reason,'SESSION_NOT_FINAL');
 assert.equal(calendarScheduleDecision([day],day.finalizedAt).state,'DUE');
 assert.equal(calendarScheduleDecision([{...day,finalizedAt:null}],day.finalizedAt).reason,'SESSION_NOT_FINAL');
 assert.equal(calendarScheduleDecision([{...day,kind:'HOLIDAY',opensAt:null,closesAt:null,finalizedAt:null}],day.finalizedAt).reason,'EXCHANGE_HOLIDAY');
});
test('missing, future-known and malformed calendars fail closed across IST midnight',()=>{
 assert.equal(calendarScheduleDecision(null,day.finalizedAt).reason,'CALENDAR_UNAVAILABLE');
 assert.equal(calendarScheduleDecision([{...day,knownAt:'2099-01-01T00:00:00Z'}],day.finalizedAt).reason,'CALENDAR_UNVERIFIED');
 assert.equal(calendarScheduleDecision([{...day,verified:false}],day.finalizedAt).reason,'CALENDAR_UNVERIFIED');
 assert.equal(calendarScheduleDecision([{...day,finalizedAt:'2026-10-19T09:00:00Z'}],day.finalizedAt).reason,'INVALID_CALENDAR');
 assert.equal(calendarScheduleDecision([day],'2026-10-19T18:30:00Z').session,'2026-10-20');
 assert.equal(calendarScheduleDecision([day],'2026-10-19T18:30:00Z').reason,'CALENDAR_UNAVAILABLE');
});
test('scheduled preparation repairs lost durable completion without resetting exhausted failures',async()=>{
 const id='00000000-0000-4000-8000-000000000001',calls=[];let removed=0;
 const db={$queryRaw:async()=>[{id}],$executeRaw:async()=>1};
 const q={add:async(name,data,options)=>{calls.push({name,data,options});return {getState:async()=>calls.length===1?'completed':'waiting',remove:async()=>removed++}}};
 assert.equal((await dispatchScheduledScans(db,q)).queued,1);assert.equal(removed,1);assert.equal(calls[0].options.jobId,calls[1].options.jobId);assert.deepEqual(calls[0].data,{scanId:id});
 assert.equal((await dispatchScheduledScans(db,{add:async()=>({getState:async()=>'failed',remove:async()=>{throw new Error('Must retain failure')}})})).queued,0);
 for(const payload of [null,[],{}, {scanId:id,bars:[]},{scanId:1}])await assert.rejects(scheduledScanHandler({})(payload),/INVALID_SCHEDULED_SCAN_PAYLOAD/);
});
