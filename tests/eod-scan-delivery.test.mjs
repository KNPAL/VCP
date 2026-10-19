import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchEodScans,eodScanHandler} from '../apps/worker/dist/eod-scan.js';
const id='a'.repeat(64);
test('EOD dispatcher repairs completed Redis jobs when SQL completion is absent',async()=>{
 const calls=[];let removed=0,recorded=0;
 const db={$queryRaw:async()=>[{id}],$executeRaw:async()=>recorded++};
 const q={add:async(name,data,options)=>{calls.push({name,data,options});return {getState:async()=>calls.length===1?'completed':'waiting',remove:async()=>removed++}}};
 assert.deepEqual(await dispatchEodScans(db,q),{queued:1});assert.equal(removed,1);assert.equal(recorded,1);
 assert.deepEqual(calls[0].data,{itemId:id});assert.equal(calls[0].options.jobId,calls[1].options.jobId);
});
test('EOD exhausted jobs retain their failed state for progress reporting',async()=>{
 let removed=0,recorded=0;
 const db={$queryRaw:async()=>[{id}],$executeRaw:async()=>recorded++};
 const q={add:async()=>({getState:async()=>'failed',remove:async()=>removed++})};
 assert.deepEqual(await dispatchEodScans(db,q),{queued:0});assert.equal(removed,0);assert.equal(recorded,1);
});
test('EOD queue handler rejects financial values and malformed identifiers before storage',async()=>{
 const handler=eodScanHandler({});
 for(const value of [null,[],{},{itemId:id,price:'100'},{itemId:12},{itemId:'not-a-hash'}])await assert.rejects(handler(value),/INVALID_EOD_SCAN_PAYLOAD/);
});
