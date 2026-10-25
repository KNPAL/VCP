import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,readDashboard,latestScan,readPortfolio} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('dashboard reads persisted full-scan counts and owner evidence without mutating the journal',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),before=await readPortfolio(db,owner.id),scan=await latestScan(db),result=await readDashboard(db,owner.id);
  assert.equal(result.executable,false);assert.deepEqual(result.risk.journal.holdings,before.holdings);
  assert.equal(result.risk.journal.cash,before.cash);assert.equal(result.readiness.items.length,10);
  if(scan&&Date.parse(scan.asOf)<=Date.parse(result.asOf)){
   assert.equal(result.scan.scanId,scan.scanId);assert.deepEqual(result.scan.counts,scan.counts);
   for(const state of ['WATCH','READY','BUY_MARKET_SIGNAL'])assert.equal(result.scan.signals[state],scan.candidates.filter(c=>c.marketState===state).length);
  }else assert.equal(result.scan,null);
  if(result.progress){assert.ok(result.progress.processed<=result.progress.intended);assert.ok(Date.parse(result.progress.asOf)<=Date.parse(result.asOf))}
  const other=await readDashboard(db,randomUUID());assert.deepEqual(other.risk.journal.holdings,{});assert.equal(other.statuses.items.length,0);assert.equal(other.risk.journal.events.length,0);
  assert.deepEqual((await readPortfolio(db,owner.id)).events,before.events);
 }finally{await db.$disconnect()}
});
