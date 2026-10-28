import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient,persistSource,persistReadiness,getReadiness,evaluateLicenseBindings} from '../packages/database/dist/index.js';
import {licensedSources} from '../fixtures/licensed-sources.mjs';
test('G07 binds every required dataset, expires with source authority and rejects superseded grants',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const knownAt=new Date(Date.now()-1000).toISOString(),now=new Date().toISOString(),sourceExpiry=new Date(Date.now()+60000).toISOString(),details=await licensedSources(db,knownAt,sourceExpiry),proof={gate:'G07',status:'PASS',probeAt:now,sourceAt:knownAt,expiresAt:new Date(Date.now()+120000).toISOString(),sourceReference:'synthetic-review',reason:null,details};
  assert.equal((await evaluateLicenseBindings(db,details,now)).status,'PASS');
  for(const invalid of [{}, {sourceBindings:details.sourceBindings.slice(1)},{sourceBindings:details.sourceBindings.map(()=>details.sourceBindings[0])}]){assert.equal((await evaluateLicenseBindings(db,invalid,now)).status,'UNKNOWN');await assert.rejects(persistReadiness(db,{...proof,details:invalid}),/LICENSE_SOURCE_BINDINGS_REQUIRED/)}
  const saved=await persistReadiness(db,proof),view=await getReadiness(db,now),gate=view.items.find(item=>item.gate==='G07');assert.equal(gate.status,'PASS');assert.equal(gate.proof.expiresAt,sourceExpiry);assert.equal(view.storedLicenseProof.expiresAt,proof.expiresAt);
  assert.equal((await getReadiness(db,sourceExpiry)).items.find(item=>item.gate==='G07').status,'UNKNOWN');
  const binding=details.sourceBindings.find(row=>row.role==='DAILY_CANDLES'),original=(await db.$queryRaw`SELECT "evidence" FROM "SourceSnapshot" WHERE "id"=${binding.sourceSnapshotId}`)[0].evidence,newTime=new Date(Date.now()+1).toISOString();
  const denied=await persistSource(db,{...original,knownAt:newTime,uses:{...original.uses,DISPLAY:false}});
  const changed=await getReadiness(db,newTime);assert.equal(changed.items.find(item=>item.gate==='G07').status,'UNKNOWN');assert.ok(changed.items.find(item=>item.gate==='G07').reason.includes('SUPERSEDED'));assert.ok(changed.blockedOperations.includes('BUY'));assert.ok(changed.blockedOperations.includes('DISPLAY'));
  const rebound={sourceBindings:details.sourceBindings.map(row=>row===binding?{...row,sourceSnapshotId:denied.id}:row)};assert.equal((await evaluateLicenseBindings(db,rebound,newTime)).status,'FAIL');
  await assert.rejects(persistReadiness(db,{...proof,probeAt:newTime,details:rebound}),/LICENSE_SOURCE_BINDINGS_REQUIRED/);
  assert.deepEqual((await db.$queryRaw`SELECT "evidence" FROM "ReadinessProof" WHERE "id"=${saved.id}`)[0].evidence,saved);
  assert.equal((await evaluateLicenseBindings(db,details,now)).status,'PASS','Historical cutoffs do not see later revocation');
 }finally{await db.$disconnect()}
});
