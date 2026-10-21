import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,recordPortfolioRisk,recordEntryRisk,readEntryRisk,readPortfolio,appendPortfolio,persistSectors} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('entry plan retries are immutable, owner scoped and never manufacture quote or gate authority',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),events=await db.$queryRaw`SELECT "id" FROM "MarketEvent" ORDER BY "decidedAt" DESC LIMIT 1`;
  assert.ok(events[0],'Run the database integration fixture before this suite');
  const before=await readPortfolio(db,owner.id),snapshot=await recordPortfolioRisk(db,owner.id,{}),key=randomUUID(),request={marketEventId:events[0].id,snapshotId:snapshot.id,estimatedFees:'1.000001'};
  const plans=await Promise.all([1,2,3].map(()=>recordEntryRisk(db,owner.id,key,request)));
  assert.deepEqual(plans[0],plans[1]);assert.deepEqual(plans[0],plans[2]);
  const plan=plans[0];assert.equal(plan.state,'BUY_BLOCKED');assert.equal(plan.quantity,0);assert.equal(plan.entry,null);assert.equal(plan.caps,null);
  const topupKey=randomUUID(),topup=await recordEntryRisk(db,owner.id,topupKey,{...request,topUpQuantity:5});
  assert.equal(topup.proposalType,'MANUAL_TOPUP');assert.equal(topup.automatedAdd,false);assert.equal(topup.state,'BUY_BLOCKED');assert.equal(topup.quantity,0);
  assert.deepEqual(await recordEntryRisk(db,owner.id,topupKey,{...request,topUpQuantity:5}),topup);
  await assert.rejects(recordEntryRisk(db,owner.id,randomUUID(),{...request,topUpQuantity:0}),/INVALID_ENTRY_PLAN/);
  assert.ok(plan.reasons.includes('QUOTE_UNKNOWN'));assert.ok(plan.reasons.includes('REGIME_EVIDENCE_REQUIRED'));assert.equal(plan.lossStreak.source,'REAL');assert.equal(plan.executable,false);
  assert.ok(Date.parse(plan.expiresAt)-Date.parse(plan.asOf)<=30000);
  assert.equal(plan.entryEvidence.evidence.riskGates.CASH,'UNKNOWN');
  assert.equal(plan.entryEvidence.evidence.gates.G04,'UNKNOWN');
  assert.equal(plan.entryEvidence.evidence.gates.G08,plan.valuation.reconciled?'PASS':'UNKNOWN');
  assert.deepEqual((await readPortfolio(db,owner.id)).events,before.events);
  await assert.rejects(recordEntryRisk(db,owner.id,key,{...request,estimatedFees:'2'}),/STALE_CONFLICT/);
  await assert.rejects(recordEntryRisk(db,randomUUID(),randomUUID(),request),/STALE_CONFLICT/);
  assert.equal((await readEntryRisk(db,randomUUID())).items.length,0);
  await assert.rejects(db.$executeRaw`DELETE FROM "EntryRiskPlan" WHERE "id"=${plan.id}`);
  await assert.rejects(db.$executeRaw`UPDATE "EntryRiskPlan" SET "journalHash"='changed' WHERE "id"=${plan.id}`);
  await persistSectors(db,[],new Date().toISOString());
  assert.ok((await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===plan.id).validityReasons.includes('SECTOR_EVIDENCE_CHANGED'));
  await appendPortfolio(db,owner.id,randomUUID(),{kind:'DEPOSIT',amount:'0.000001',verified:true,occurredAt:new Date().toISOString(),sourceId:'synthetic-plan-test'});
  assert.equal((await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===plan.id).current,false);
  await assert.rejects(recordEntryRisk(db,owner.id,randomUUID(),request),/STALE_CONFLICT/);
  // Retrying the original key returns the historical audit record, not a refreshed plan.
  assert.deepEqual(await recordEntryRisk(db,owner.id,key,request),plan);
  const fresh=await recordPortfolioRisk(db,owner.id,{}),request2={...request,snapshotId:fresh.id};
  const results=await Promise.allSettled([
   recordEntryRisk(db,owner.id,randomUUID(),request2),
   appendPortfolio(db,owner.id,randomUUID(),{kind:'DEPOSIT',amount:'0.000001',verified:true,occurredAt:new Date().toISOString(),sourceId:'synthetic-plan-race'})
  ]);
  assert.equal(results[1].status,'fulfilled');
  if(results[0].status==='fulfilled')assert.equal((await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===results[0].value.id).current,false);
  else assert.match(String(results[0].reason),/STALE_CONFLICT/);
 }finally{await db.$disconnect()}
});

