import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {persistMarketEvent,persistReadiness,readMarketSignals,recordPortfolioRisk,recordEntryRisk,readEntryRisk,readPortfolio,appendPortfolio,persistSectors,registerProfile} from '../packages/database/dist/index.js';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {breakoutInput} from '../fixtures/signal-golden.mjs';
import {ST_VCP_4_0,PROFILE_VERSION,evaluateBreakout} from '../packages/strategy/dist/index.js';
let db;
test('entry plan retries are immutable, owner scoped and never manufacture quote or gate authority',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const fixture=await isolatedDatabase('entry_risk');db=fixture.db;
 try{
  const owner=await db.owner.findFirstOrThrow(),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0),input=breakoutInput();
  input.previous.listingId=randomUUID();input.previous.configHash=profile.id;input.evidence.configHash=profile.id;input.evidence.dataRevision=randomUUID();
  const event=evaluateBreakout(input).event;await persistMarketEvent(db,event);const events=[event];
  await appendPortfolio(db,owner.id,randomUUID(),{kind:'INITIAL_CAPITAL',amount:'10000',verified:true,occurredAt:new Date().toISOString(),sourceId:'synthetic-entry-risk'});
  const signals=await readMarketSignals(db);assert.equal(signals.executable,false);assert.ok(signals.items.length>0&&signals.items.length<=50);assert.equal(new Set(signals.items.map(item=>item.logicalId)).size,signals.items.length);for(const item of signals.items){for(const field of ['decidedAt','observedAt','occurredAt'])assert.ok(Date.parse(item[field])<=Date.parse(signals.asOf))}
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
  assert.match(plan.sourceRevision,/^[a-f0-9]{64}$/);assert.ok(Object.hasOwn(plan.sourceIds,'mappingId'));
  await persistReadiness(db,{gate:'G06',status:'UNKNOWN',reason:'SYNTHETIC_RESTRICTIONS_CHANGED',probeAt:new Date().toISOString(),sourceAt:null,expiresAt:new Date(Date.now()+60000).toISOString(),sourceReference:null,details:null});
  const changed=(await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===plan.id);
  assert.equal(changed.current,false);assert.ok(changed.validityReasons.includes('ENTRY_SOURCE_CHANGED_OR_UNVERIFIED'));
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
  assert.equal(results[1].status,'fulfilled',results[1].status==='rejected'?String(results[1].reason):undefined);
  if(results[0].status==='fulfilled')assert.equal((await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===results[0].value.id).current,false);
  else assert.match(String(results[0].reason),/STALE_CONFLICT/);
  const original=(await db.$queryRaw`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${events[0].id}`)[0].evidence;
  const hash=()=>createHash('sha256').update(randomUUID()).digest('hex'),logicalId=hash();
  const base={...original,id:hash(),logicalId,decidedAt:new Date(Date.now()-1000).toISOString()};
  base.effectiveAt=base.decidedAt;await persistMarketEvent(db,base);
  const sourceRisk=await recordPortfolioRisk(db,owner.id,{}),sourceRequest={...request,marketEventId:base.id,snapshotId:sourceRisk.id};
  const sourcePlan=await recordEntryRisk(db,owner.id,randomUUID(),sourceRequest);
  const correction={...base,id:hash(),dataRevision:'synthetic-corrected-'+randomUUID(),type:'BREAKOUT_PRICE_ONLY',decidedAt:new Date().toISOString()};
  correction.effectiveAt=correction.decidedAt;await persistMarketEvent(db,correction);
  const invalidated=(await readEntryRisk(db,owner.id)).items.find(p=>p.evidence.id===sourcePlan.id);
  assert.equal(invalidated.current,false);assert.ok(invalidated.validityReasons.includes('MARKET_EVENT_SUPERSEDED_OR_NOT_KNOWN'));
  const attempted=await recordEntryRisk(db,owner.id,randomUUID(),sourceRequest);
  assert.equal(attempted.state,'BUY_BLOCKED');assert.ok(attempted.reasons.includes('MARKET_EVENT_SUPERSEDED_OR_NOT_KNOWN'));
  const latest=await readMarketSignals(db);assert.equal(latest.items.find(item=>item.logicalId===logicalId).id,correction.id);
  assert.equal((await readMarketSignals(db,'BREAKOUT_CONFIRMED')).items.some(item=>item.logicalId===logicalId),false,'Filtering must not resurrect superseded confirmation');
  assert.equal((await readMarketSignals(db,'BREAKOUT_PRICE_ONLY')).items.find(item=>item.logicalId===logicalId).id,correction.id);
 }finally{await fixture.close()}
});
