import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {queue,createWorker,enqueueOnce,acquireLease,renewLease,releaseLease,scheduleFinalized} from '../apps/worker/dist/runtime.js';
test('Redis job deduplication, failed jobs, sessions and fencing',async()=>{
 process.env.REDIS_PORT='56379';const name='test-'+randomUUID();const q=queue(name);let runs=0;
 const worker=createWorker(name,{probe:async()=>{runs++;return {ok:true}}});
 try{
 const a=await enqueueOnce(q,'probe','same',{});const b=await enqueueOnce(q,'probe','same',{});assert.equal(a.id,b.id);
 const deadline=Date.now()+10000;while(await a.getState()!=='completed'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 assert.equal(await a.getState(),'completed');assert.equal(runs,1);
 const bad=await enqueueOnce(q,'unsupported','bad',{});while(await bad.getState()!=='failed'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.equal(await bad.getState(),'failed');
 assert.equal((await scheduleFinalized(q,null,new Date().toISOString())).state,'UNKNOWN');
 assert.equal((await scheduleFinalized(q,[{date:'2026-10-16',opensAt:'2026-10-16T03:45:00Z',finalizedAt:null}],new Date().toISOString())).count,0);
 const token=await acquireLease(q,name);assert.ok(token);assert.equal(await acquireLease(q,name),null);
 assert.equal(await renewLease(q,name,'wrong'),false);assert.equal(await releaseLease(q,name,'wrong'),false);
 assert.equal(await releaseLease(q,name,token),true);const next=await acquireLease(q,name);assert.ok(BigInt(next)>BigInt(token));
 assert.equal(await renewLease(q,name,token),false);await releaseLease(q,name,next);
 }finally{await worker.close();await q.obliterate({force:true});await q.close()}
});
