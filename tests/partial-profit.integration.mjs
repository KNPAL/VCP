import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {PrismaClient,appendPortfolio,readPortfolio,registerProfile,persistInstrumentSnapshot,evaluatePartialProfit,dismissPartialProfit,evaluatePositionStop,readPositionStops,readSellAlerts,acknowledgePositionAlert,evaluateExitDecisions,hasHigherExit} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
const db=new PrismaClient(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('partial alerts deduplicate, resolve from actual fills or dismissal, and yield to full SELL',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
  for(const outcome of ['DISMISSED','ACTUAL_SELL_RECORDED','CANCELLED_FULL_SELL']){
   const before=new Date(Date.now()-10000).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10),listingId=randomUUID(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
   await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-partial',rows:[{companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'PARTIAL',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
   const sourceId=hash(randomUUID()),source={id:sourceId,input:{listingId,configHash:profile.id,decidedAt:before,scaleRevision:hash([])},detector:{frozen:{primary:{state:'READY',lastLow:'95.02',asOf:before}}}};
   await db.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${sourceId},${listingId}::uuid,${new Date(date)},${profile.id},${JSON.stringify(source)}::jsonb)`;
   const adjustmentId=hash(randomUUID()),actionSource={id:hash(randomUUID()),listingId,knownAt:before,verified:true,sourceReference:'synthetic-partial',coverageFrom:'2020-01-01',coverageThrough:date,actions:[]};
   await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${adjustmentId},${listingId}::uuid,${new Date(date)},${new Date(before)},'KNOWN',${JSON.stringify({source:actionSource})}::jsonb)`;
   const fill={kind:'FILL',isin,side:'BUY',quantity:10,price:'100',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-partial'};
   await appendPortfolio(db,owner.id,randomUUID(),fill);
   const quote=()=>{const at=new Date().toISOString();return {listingId,ltp:'110.10',sourceAt:at,receivedAt:at,session:date,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(Date.now()+30000).toISOString()}};
   const journal=(await readPortfolio(db,owner.id)).events;
   const results=await Promise.all([1,2,3].map(()=>evaluatePartialProfit(db,owner.id,isin,quote())));
   assert.equal(results.filter(r=>r.created).length,1,JSON.stringify(results));const signal=results.find(r=>r.created).evidence;
   assert.equal(signal.quantity,3);const sellView=(await readSellAlerts(db,owner.id)).items.find(i=>i.isin===isin);assert.equal(sellView.primary.kind,'PARTIAL_PROFIT');assert.equal(sellView.primary.quantity,3);assert.equal(sellView.primary.sourcePrice,'110.10');assert.equal(sellView.manualExecutionPending,true);assert.equal(sellView.executable,false);assert.deepEqual((await readPortfolio(db,owner.id)).events,journal);
   const outbox=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${signal.id}`;assert.equal(outbox.length,1);
   if(outcome==='DISMISSED'){
    const key=randomUUID(),first=await dismissPartialProfit(db,owner.id,key,signal.id,'Owner decision');assert.deepEqual(await dismissPartialProfit(db,owner.id,key,signal.id,'Owner decision'),first);
    await assert.rejects(dismissPartialProfit(db,owner.id,key,signal.id,'Changed reason'),/STALE_CONFLICT/);
    assert.deepEqual(await dismissPartialProfit(db,owner.id,randomUUID(),signal.id,'Second dismissal'),first);
    await assert.rejects(dismissPartialProfit(db,randomUUID(),randomUUID(),signal.id,'Other owner'),/PARTIAL_SIGNAL_NOT_FOUND/);
   }else if(outcome==='ACTUAL_SELL_RECORDED')await appendPortfolio(db,owner.id,randomUUID(),{...fill,side:'SELL',quantity:3,brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
   else assert.equal((await evaluatePositionStop(db,owner.id,isin,{...quote(),ltp:'90'})).state,'SELL_PROTECTIVE');
   const item=(await readPositionStops(db,owner.id)).partials.find(p=>p.evidence.id===signal.id);assert.equal(item.resolutions.length,1);assert.equal(item.resolutions[0].state,outcome);
   assert.equal((await evaluatePartialProfit(db,owner.id,isin,quote())).state,'ALREADY_EMITTED');
   assert.equal((await readPortfolio(db,owner.id)).holdings[isin],outcome==='ACTUAL_SELL_RECORDED'?7:10);
   if(outcome==='CANCELLED_FULL_SELL'){
    await evaluateExitDecisions(db,owner.id,isin);await evaluateExitDecisions(db,owner.id,isin);
    let view=await readPositionStops(db,owner.id);assert.equal(view.exitDecisions.find(d=>d.isin===isin).result.state,'SELL_PROTECTIVE');
    const count=await db.$queryRaw`SELECT count(*)::int AS count FROM "ExitDecision" WHERE "stopId"=${signal.stopId}`;assert.equal(count[0].count,2);
    const collisionId=hash(randomUUID()),collision={id:collisionId,input:{sourceRevision:'synthetic-collision'},result:{state:'SELL_EMA_CLOSE'}};
    await db.$executeRaw`INSERT INTO "PositionTrail" ("id","ownerId","stopId","session","decidedAt","effectiveAt","state","evidence") VALUES (${collisionId},${owner.id}::uuid,${signal.stopId},${new Date(date)},clock_timestamp(),clock_timestamp(),'SELL_EMA_CLOSE',${JSON.stringify(collision)}::jsonb)`;
    const prioritized=(await readSellAlerts(db,owner.id)).items.find(i=>i.isin===isin);assert.equal(prioritized.primary.kind,'SELL_PROTECTIVE');assert.equal(prioritized.primary.quantity,10);assert.equal(prioritized.suppressedCount,1);assert.equal(prioritized.primary.sourcePrice,'90');await acknowledgePositionAlert(db,owner.id,prioritized.primary.id,'Reviewed collision');const acknowledged=(await readSellAlerts(db,owner.id)).items.find(i=>i.isin===isin);assert.ok(acknowledged.primary.acknowledgement);assert.equal(acknowledged.manualExecutionPending,true);
    assert.equal(await db.$transaction(tx=>hasHigherExit(tx,signal.stopId,'SELL_EMA_CLOSE')),true);
    await evaluateExitDecisions(db,owner.id,isin);view=await readPositionStops(db,owner.id);assert.equal(view.exitDecisions.find(d=>d.isin===isin).result.state,'SELL_PROTECTIVE');
    await appendPortfolio(db,owner.id,randomUUID(),{...fill,side:'SELL',quantity:10,brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
    view=await readPositionStops(db,owner.id);assert.equal(view.exitDecisions.find(d=>d.isin===isin).result.state,'CLOSED_WITHOUT_SIGNAL_EXECUTION');assert.equal(view.exitResolutions.filter(r=>r.isin===isin).length,2);assert.equal((await readSellAlerts(db,owner.id)).items.some(i=>i.isin===isin),false);assert.deepEqual((await readSellAlerts(db,randomUUID())).items,[]);
    const decision=view.exitDecisions.find(d=>d.isin===isin);await assert.rejects(db.$executeRaw`DELETE FROM "ExitDecision" WHERE "id"=${decision.id}`);
   }
   await assert.rejects(db.$executeRaw`DELETE FROM "PartialProfitSignal" WHERE "id"=${signal.id}`);
  }
 }finally{await db.$disconnect()}
});

