import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {PrismaClient,appendPortfolio,recordPositionMonitor,readPositionMonitor,readPortfolio} from '../packages/database/dist/index.js';
const db=new PrismaClient();
test('monitor alerts deduplicate; recovery and worker gaps persist; fills alone close positions',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
  const historyFor=async()=>{const result=await readPositionMonitor(db,owner.id);return {...result,items:result.items.filter(r=>r.isin===isin),events:result.events.filter(r=>r.isin===isin)}};
  const now=Date.now(),at=offset=>new Date(now+offset).toISOString();
  if((await readPortfolio(db,owner.id)).cash===null)await appendPortfolio(db,owner.id,'monitor-capital',{kind:'INITIAL_CAPITAL',amount:'10000',verified:true,occurredAt:at(-120000),sourceId:'fixture'});
  await appendPortfolio(db,owner.id,'buy-'+isin,{kind:'FILL',isin,side:'BUY',quantity:10,price:'100',fees:'0',brokerReference:'buy-'+isin,occurredAt:at(-110000),sourceId:'fixture'});
  // Actual journal records are known only after creation; use controlled past monitor state to simulate a restart below.
  const degraded={state:'MONITOR_DEGRADED',reason:'FEED_DISCONNECTED',sourceAt:null,listingId:null,session:at(0).slice(0,10),executable:false};
  await Promise.all([1,2].map(()=>recordPositionMonitor(db,owner.id,{[isin]:degraded})));
  await recordPositionMonitor(db,owner.id,{[isin]:degraded});
  let history=await historyFor();assert.equal(history.events.length,1);assert.equal(history.items[0].quantity,10);assert.equal(history.events[0].priority,'URGENT');
  const alerts=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${history.events[0].id}`;assert.equal(alerts.length,1);
  const fresh={...degraded,state:'FEED_FRESH',validUntil:new Date(Date.now()+30000).toISOString(),sourceAt:new Date().toISOString(),reason:'QUOTE_AND_CONNECTION_CURRENT'};
  await recordPositionMonitor(db,owner.id,{[isin]:fresh});history=await historyFor();assert.equal(history.events.length,2);assert.equal(history.items[0].gapStartedAt,null);assert.equal(history.events[0].kind,'MONITOR_RECOVERED');assert.ok(history.events[0].gapEndedAt);
  const old={...history.items[0],asOf:at(-20000)};
  await db.$executeRaw`UPDATE "PositionMonitor" SET "asOf"=${new Date(old.asOf)},"evidence"=${JSON.stringify(old)}::jsonb WHERE "ownerId"=${owner.id}::uuid AND "isin"=${isin}`;
  assert.equal((await historyFor()).items[0].reason,'MONITOR_WORKER_STALE');
  await recordPositionMonitor(db,owner.id,{[isin]:fresh});history=await historyFor();assert.equal(history.events.length,4);assert.ok(history.events.some(e=>e.reason==='MONITOR_POLL_GAP'));
  await recordPositionMonitor(db,owner.id,{[isin]:degraded});
  await appendPortfolio(db,owner.id,'sell-'+isin,{kind:'FILL',isin,side:'SELL',quantity:10,price:'100',fees:'0',brokerReference:'sell-'+isin,occurredAt:new Date().toISOString(),sourceId:'fixture'});
  await recordPositionMonitor(db,owner.id,{});history=await historyFor();assert.equal(history.items[0].state,'CLOSED');assert.equal(history.items[0].quantity,0);assert.ok(history.events.some(e=>e.reason==='ACTUAL_POSITION_CLOSED'));
  const count=history.events.length;await recordPositionMonitor(db,owner.id,{});assert.equal((await historyFor()).events.length,count);
  await assert.rejects(db.$executeRaw`DELETE FROM "PositionMonitorEvent" WHERE "ownerId"=${owner.id}::uuid`);
  assert.equal((await readPositionMonitor(db,randomUUID())).items.length,0);
 }finally{await db.$disconnect()}
});


