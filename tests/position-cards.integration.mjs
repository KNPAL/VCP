import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,readPositionCards,readPortfolio} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('position cards project only actual owner holdings and unknown data cannot become a fresh mark',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),journal=await readPortfolio(db,owner.id),result=await readPositionCards(db,owner.id);
  assert.equal(result.executable,false);assert.equal(result.items.length,journal.positions.length);
  for(const item of result.items){const position=journal.positions.find(p=>p.isin===item.isin);assert.equal(item.quantity,position.quantity);assert.equal(item.costBasis,position.costBasis);assert.equal(item.realizedPnl,position.realizedPnl);assert.equal(item.remainingEntry,position.weightedEntry.weightedEntry);if(item.mark===null){assert.equal(item.unrealizedPnl,null);assert.equal(item.rMultiple,null)}if(item.ema21!==null)assert.ok(item.emaSourceAt&&item.executionId);if(item.statusValidUntil===null)assert.equal(item.status,'UNABLE_TO_EVALUATE')}
  assert.deepEqual((await readPositionCards(db,randomUUID())).items,[]);assert.deepEqual((await readPortfolio(db,owner.id)).events,journal.events);
 }finally{await db.$disconnect()}
});
