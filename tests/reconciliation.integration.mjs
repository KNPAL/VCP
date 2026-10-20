import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,readPortfolio,appendPortfolio,recordReconciliation,readReconciliation} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('statement evidence is immutable, idempotent and invalidated by concurrent journal changes',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),portfolio=await readPortfolio(db,owner.id),key=randomUUID();assert.ok(portfolio.cash);
  const statement={asOf:new Date().toISOString(),sourceReference:'test-'+key,cash:portfolio.cash,holdings:portfolio.positions.map(p=>({isin:p.isin,quantity:p.quantity})),fillReferences:portfolio.events.filter(e=>e.kind==='FILL'&&!portfolio.reversed.includes(e.id)).map(e=>e.brokerReference),allOutsideActivityIncluded:true};
  const saved=await Promise.all([1,2].map(()=>recordReconciliation(db,owner.id,key,statement)));assert.deepEqual(saved[0],saved[1]);assert.equal(saved[0].result.state,'RECONCILED_AS_OF');
  assert.equal((await readReconciliation(db,owner.id)).state,'RECONCILED_AS_OF');
  await assert.rejects(recordReconciliation(db,owner.id,key,{...statement,cash:'1'}),/STALE_CONFLICT/);
  await assert.rejects(recordReconciliation(db,owner.id,randomUUID(),{...statement,asOf:'2020-01-01T00:00:00Z'}),/STALE_CONFLICT/);
  await Promise.all([appendPortfolio(db,owner.id,randomUUID(),{kind:'DEPOSIT',amount:'0.000001',verified:true,occurredAt:new Date().toISOString(),sourceId:'test-reconciliation'}),recordReconciliation(db,owner.id,randomUUID(),statement)]);
  assert.equal((await readReconciliation(db,owner.id)).state,'PORTFOLIO_UNRECONCILED');
  await assert.rejects(db.$executeRaw`DELETE FROM "PortfolioReconciliation" WHERE "id"=${saved[0].id}`);
  const stored=await db.$queryRaw`SELECT "evidence" FROM "PortfolioReconciliation" WHERE "id"=${saved[0].id}`;assert.deepEqual(stored[0].evidence,saved[0]);
  assert.equal((await readReconciliation(db,randomUUID())).state,'PORTFOLIO_UNRECONCILED');
 }finally{await db.$disconnect()}
});
