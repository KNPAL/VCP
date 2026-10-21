import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,recordShadowAudit,readShadowAudits,readPortfolio} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('offline shadow audit logs unavailable responses, preserves retries and cannot mutate actual portfolio',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),before=await readPortfolio(db,owner.id),at=new Date().toISOString();
  const input={mode:'SHADOW',at,strategyVersion:'ST_VCP_4_0',modelVersion:'offline-fixture-1',promptVersion:'prompt-fixture-1',evidence:['VCP','RS','VOLUME','PIVOT','PORTFOLIO_RISK','SOURCE_QUALITY'].map(kind=>({kind,revision:'synthetic-1',at,quality:'VERIFIED'})),response:null};
  const key=randomUUID(),records=await Promise.all([1,2,3].map(()=>recordShadowAudit(db,owner.id,key,input)));
  assert.deepEqual(records[0],records[1]);assert.deepEqual(records[1],records[2]);
  const saved=records[0];assert.equal(saved.outcome,'UNAVAILABLE');assert.equal(saved.result.reason,'SERVICE_UNAVAILABLE');assert.equal(saved.result.evidence.length,6);
  await assert.rejects(recordShadowAudit(db,owner.id,key,{...input,mode:'DISABLED'}),/STALE_CONFLICT/);
  for(const outcome of ['PASS','VETO','REVIEW_REQUIRED','UNAVAILABLE']){
   const record=await recordShadowAudit(db,owner.id,randomUUID(),{...input,response:{version:'response-1',at,outcome}});
   assert.equal(record.outcome,outcome);assert.equal(record.authoritative,false);assert.equal(record.executable,false);
  }
  const invalid=await recordShadowAudit(db,owner.id,randomUUID(),{...input,response:{version:'r1',at,outcome:'PASS',arbitraryText:'DO_NOT_STORE'}});
  assert.equal(invalid.result.reason,'INVALID_RESPONSE');assert.equal(JSON.stringify(invalid).includes('DO_NOT_STORE'),false);
  const malformed=await recordShadowAudit(db,owner.id,randomUUID(),{...input,at:'invalid'});
  assert.equal(malformed.rejection,'INVALID_SHADOW_INPUT');assert.equal(malformed.outcome,'UNAVAILABLE');
  const disabled=await recordShadowAudit(db,owner.id,randomUUID(),{...input,mode:'DISABLED'});assert.equal(disabled.result.reason,'AI_DISABLED');
  await assert.rejects(db.$executeRaw`DELETE FROM "ShadowReviewAudit" WHERE "id"=${saved.id}`);
  await assert.rejects(db.$executeRaw`UPDATE "ShadowReviewAudit" SET "requestHash"='changed' WHERE "id"=${saved.id}`);
  assert.equal((await readShadowAudits(db,randomUUID())).items.length,0);
  assert.ok((await readShadowAudits(db,owner.id)).items.some(r=>r.id===saved.id));
  assert.deepEqual((await readPortfolio(db,owner.id)).events,before.events);
 }finally{await db.$disconnect()}
});
