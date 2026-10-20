import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,appendPortfolio,readPortfolio,recordPortfolioRisk,readPortfolioRisk,recordCashAllocation,cashAllocations} from '../packages/database/dist/index.js';
import {lossStreak} from '../packages/portfolio/dist/index.js';
const db=new PrismaClient();
test('cash attribution is versioned, serialized and journal-neutral; loss evidence is immutable',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
  const fill=(side)=>({kind:'FILL',isin,side,quantity:1,price:side==='BUY'?'100':'99',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-streak'});
  const first=await appendPortfolio(db,owner.id,randomUUID(),fill('BUY'));await appendPortfolio(db,owner.id,randomUUID(),fill('SELL'));
  const second=await appendPortfolio(db,owner.id,randomUUID(),fill('BUY'));await appendPortfolio(db,owner.id,randomUUID(),fill('SELL'));
  const third=await appendPortfolio(db,owner.id,randomUUID(),fill('BUY'));await appendPortfolio(db,owner.id,randomUUID(),fill('SELL'));
  const beforeCash=await recordPortfolioRisk(db,owner.id,{});
  assert.equal(beforeCash.lossStreak.source,'REAL');assert.equal(beforeCash.lossStreak.episodes.find(e=>e.id===third.eventIds[0]).netPnl,'-1.000000');
  const credit=await appendPortfolio(db,owner.id,randomUUID(),{kind:'CORPORATE_CREDIT',amount:'2',verified:true,occurredAt:new Date().toISOString(),sourceId:'synthetic-streak-credit'});
  let risk=await readPortfolioRisk(db,owner.id);assert.equal(risk.lossStreak.state,'UNKNOWN');assert.ok(risk.lossStreak.unallocatedCashEventIds.includes(credit.eventIds[0]));
  const journal=await readPortfolio(db,owner.id),key=randomUUID(),input={cashEventId:credit.eventIds[0],episodeId:first.eventIds[0],reason:'synthetic verified allocation'};
  const results=await Promise.all([1,2,3].map(()=>recordCashAllocation(db,owner.id,key,input)));assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  assert.deepEqual((await readPortfolio(db,owner.id)).events,journal.events);
  risk=await recordPortfolioRisk(db,owner.id,{});assert.equal(risk.lossStreak.episodes.find(e=>e.id===first.eventIds[0]).netPnl,'1.000000');
  const calendar=await db.$queryRaw`SELECT "evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const expected=lossStreak({events:journal.events,allocations:await cashAllocations(db,owner.id),calendar:calendar[0]?.evidence??null,asOf:risk.asOf,source:'REAL'});assert.deepEqual(risk.lossStreak,expected);
  await assert.rejects(recordCashAllocation(db,owner.id,key,{...input,episodeId:second.eventIds[0]}),/STALE_CONFLICT/);
  await assert.rejects(recordCashAllocation(db,randomUUID(),randomUUID(),input),/INVALID_CASH_ALLOCATION/);
  await assert.rejects(recordCashAllocation(db,owner.id,randomUUID(),{...input,cashEventId:third.eventIds[0]}),/INVALID_CASH_ALLOCATION/);
  const revision=risk.cashAllocationRevision;
  await recordCashAllocation(db,owner.id,randomUUID(),{...input,episodeId:second.eventIds[0],reason:'corrected attribution'});
  const changed=await readPortfolioRisk(db,owner.id);assert.notEqual(changed.cashAllocationRevision,revision);assert.equal(changed.lossStreak.episodes.find(e=>e.id===first.eventIds[0]).netPnl,'-1.000000');assert.equal(changed.lossStreak.episodes.find(e=>e.id===second.eventIds[0]).netPnl,'1.000000');
  const original=await db.$queryRaw`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "id"=${risk.id}`;assert.deepEqual(original[0].evidence.lossStreak,risk.lossStreak);
  await assert.rejects(db.$executeRaw`DELETE FROM "PortfolioCashAllocation" WHERE "id"=${results[0].id}`);
  await assert.rejects(db.$executeRaw`UPDATE "PortfolioCashAllocation" SET "episodeId"=${third.eventIds[0]}::uuid WHERE "id"=${results[0].id}`);
  assert.equal((await readPortfolioRisk(db,randomUUID())).lossStreak.source,'REAL');
 }finally{await db.$disconnect()}
});
