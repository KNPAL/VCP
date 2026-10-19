import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {reserveBrokerBudget} from '../apps/worker/dist/broker-budget.js';
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

test('global broker budgets share atomic rolling ceilings and retain lower verified caps across workers',async()=>{
 process.env.REDIS_PORT='56379';const q1=queue('quota-'+randomUUID()),q2=queue('quota-'+randomUUID());
 const account=createHash('sha256').update(randomUUID()).digest('hex'),base='broker:{'+account+'}';
 const keys=[base+':requests',base+':sequence',base+':caps'];
 const client=await q1.client;
 client.defineCommand('vcp_test_seed_budget',{numberOfKeys:1,lua:"redis.call('DEL',KEYS[1]);local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000);for i=1,tonumber(ARGV[1]) do redis.call('ZADD',KEYS[1],now-tonumber(ARGV[2]),'seed-'..i) end;return 1"});
 client.defineCommand('vcp_test_clear_budget',{numberOfKeys:3,lua:"return redis.call('DEL',KEYS[1],KEYS[2],KEYS[3])"});
 const seed=(count,age)=>client.runCommand('vcp_test_seed_budget',[keys[0],count,age]);
 try{
  const burst=await Promise.all(Array.from({length:12},(_,i)=>reserveBrokerBudget(i%2?q1:q2,account)));
  assert.equal(burst.filter(r=>r.allowed).length,1);assert.ok(burst.filter(r=>!r.allowed).every(r=>r.retryAfterMs>0));
  await seed(60,2000);const minute=await reserveBrokerBudget(q2,account);assert.equal(minute.allowed,false);assert.ok(minute.retryAfterMs>50000);
  await seed(3000,120000);const hour=await reserveBrokerBudget(q1,account);assert.equal(hour.allowed,false);assert.ok(hour.retryAfterMs>3000000);
  await seed(1,1001);assert.equal((await reserveBrokerBudget(q1,account)).allowed,true);
  await seed(0,0);await reserveBrokerBudget(q1,account,{verified:true,second:1,minute:2,hour:10});
  await seed(2,2000);const lower=await reserveBrokerBudget(q2,account);assert.equal(lower.allowed,false);assert.deepEqual(lower.caps,{second:1,minute:2,hour:10});
  await assert.rejects(reserveBrokerBudget(q1,account,{verified:false,second:1,minute:1,hour:1}),/INVALID_VERIFIED_QUOTA/);
 }finally{await client.runCommand('vcp_test_clear_budget',keys);await q1.close();await q2.close()}
});
