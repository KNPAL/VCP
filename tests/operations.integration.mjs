import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {readOperations} from '../packages/database/dist/index.js';
test('operations isolates broker errors by owner binding and reports unverified gates and absent telemetry',async()=>{
 const fixture=await isolatedDatabase('operations'),db=fixture.db;
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,key='a'.repeat(64),at=new Date();
  const initial=await readOperations(db,owner);
  assert.equal(initial.readiness,'BLOCKED');assert.equal(initial.gates.length,10);
  assert.equal(initial.feedAgeSeconds,null);assert.equal(initial.finalizedSession,null);
  assert.equal(initial.scan,null);assert.equal(initial.pendingSell,0);assert.equal(initial.queue.due,0);
  for(const [accountKey,httpStatus] of [[key,403],[key,429],['b'.repeat(64),403]]){
   await db.brokerRequestAttempt.create({data:{accountKey,requestId:randomUUID(),attempt:1,at,httpStatus}});
  }
  const own=await readOperations(db,owner,key);
  assert.equal(own.attempts.length,1);
  assert.deepEqual([own.attempts[0].requests,own.attempts[0].forbidden,own.attempts[0].limited,own.attempts[0].errors],[2,1,1,2]);
  assert.deepEqual((await readOperations(db,owner)).attempts,[]);
 }finally{await fixture.close()}
});
