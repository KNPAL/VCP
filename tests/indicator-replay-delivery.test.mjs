import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchIndicatorReplays,indicatorReplayHandler} from '../apps/worker/dist/indicator-replay.js';
const input={eventId:'00000000-0000-4000-8000-000000000001',adjustmentId:'a'.repeat(64),calendarHash:'b'.repeat(64)};
test('indicator dispatch reconstructs a completed job without a durable receipt',async()=>{
 const calls=[],records=[];let removed=0;
 const db={$queryRaw:async()=>[input],$executeRaw:async(...args)=>records.push(args)};
 const q={add:async(name,data,options)=>{calls.push({name,data,options});return {getState:async()=>calls.length===1?'completed':'waiting',remove:async()=>removed++}}};
 assert.deepEqual(await dispatchIndicatorReplays(db,q),{queued:1});assert.equal(removed,1);
 assert.equal(calls[0].options.jobId,calls[1].options.jobId);assert.deepEqual(calls[0].data,input);assert.equal(records.length,1);
});
test('exhausted indicator replay jobs are recorded without restarting them indefinitely',async()=>{
 let removed=0,recorded=false;
 const db={$queryRaw:async()=>[input],$executeRaw:async()=>{recorded=true}};
 const q={add:async()=>({getState:async()=>'failed',remove:async()=>removed++})};
 assert.deepEqual(await dispatchIndicatorReplays(db,q),{queued:0});assert.equal(removed,0);assert.equal(recorded,true);
});
test('replay handler rejects supplied financial payloads before touching storage',async()=>{
 const handler=indicatorReplayHandler({});
 for(const data of [null,[],{}, {...input,bars:[]},{...input,eventId:123}])await assert.rejects(handler(data),/INVALID_REPLAY_PAYLOAD/);
});
