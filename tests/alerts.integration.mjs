import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient,appendAlert,claimAlert,finishAlert,deliverAlert,persistMarketEvent} from '../packages/database/dist/index.js';
import {evaluateBreakout,ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {registerProfile} from '../packages/database/dist/index.js';
import {breakoutInput} from '../fixtures/signal-golden.mjs';
const db=new PrismaClient();
test('transactional alerts survive duplicate, crash, lease loss and unavailable delivery',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow();const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
  const input=breakoutInput();input.previous.listingId=randomUUID();input.previous.configHash=profile.id;input.evidence.configHash=profile.id;const market=evaluateBreakout(input).event;assert.ok(market);
  await Promise.all([persistMarketEvent(db,market),persistMarketEvent(db,market)]);
  const rows=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${market.id}`;assert.equal(rows.length,1);const id=rows[0].id;
  const claims=await Promise.all([claimAlert(db,30000,id),claimAlert(db,30000,id)]);assert.equal(claims.filter(Boolean).length,1);const old=claims.find(Boolean);
  await db.$executeRaw`UPDATE "NotificationDelivery" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "outboxId"=${id}`;
  const resumed=await claimAlert(db,30000,id);assert.equal(resumed.attempt,2);assert.notEqual(resumed.token,old.token);assert.equal(await finishAlert(db,old,true),false);assert.equal(await finishAlert(db,resumed,false),true);
  assert.equal(await claimAlert(db,30000,id),null);
  await db.$executeRaw`UPDATE "NotificationDelivery" SET "nextAttemptAt"=clock_timestamp() WHERE "outboxId"=${id}`;
  assert.equal((await deliverAlert(db,undefined,id)).state,'DELIVERED');assert.equal((await deliverAlert(db,undefined,id)).state,'IDLE');
  assert.equal((await db.$queryRaw`SELECT "id" FROM "InboxNotification" WHERE "id"=${id}`).length,1);
  const invalid={...market,id:createHash('sha256').update(randomUUID()).digest('hex'),logicalId:createHash('sha256').update(randomUUID()).digest('hex'),effectiveAt:'2020-01-01T00:00:00Z'};
  await assert.rejects(persistMarketEvent(db,invalid),/CHRONOLOGY/);assert.equal((await db.$queryRaw`SELECT "id" FROM "MarketEvent" WHERE "id"=${invalid.id}`).length,0);
  const eventId=createHash('sha256').update(randomUUID()).digest('hex'),now=new Date().toISOString();
  const event={id:eventId,sourceEventId:eventId,kind:'SELL',sourceAt:now,occurredAt:now,decidedAt:now,effectiveAt:now,strategyVersion:'ST_VCP_4_0',configHash:market.configHash,dataRevision:'synthetic',executable:false};
  await assert.rejects(db.$transaction(async tx=>{await appendAlert(tx,event,[owner.id],['EMAIL']);throw new Error('ROLLBACK')}),/ROLLBACK/);
  assert.equal((await db.$queryRaw`SELECT "id" FROM "AlertEvent" WHERE "id"=${eventId}`).length,0);
  await db.$transaction(tx=>appendAlert(tx,event,[owner.id],['EMAIL']));const email=(await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${eventId}`)[0].id;
  for(let i=0;i<4;i++){await db.$executeRaw`UPDATE "NotificationDelivery" SET "nextAttemptAt"=clock_timestamp() WHERE "outboxId"=${email}`;await deliverAlert(db,async()=>{throw new Error('secret-provider-response')},email)}
  const failed=(await db.$queryRaw`SELECT * FROM "NotificationDelivery" WHERE "outboxId"=${email}`)[0];assert.equal(failed.state,'FAILED');assert.equal(failed.attempts,4);assert.equal(failed.reason,'ADAPTER_UNAVAILABLE');assert.equal(await claimAlert(db,30000,email),null);
  assert.equal((await db.$queryRaw`SELECT "id" FROM "AlertEvent" WHERE "id"=${eventId}`).length,1);
  await db.$transaction(tx=>appendAlert(tx,event,[owner.id],['IN_APP']));const inboxId=(await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${eventId} AND "channel"='IN_APP'`)[0].id;
  const crashed=await claimAlert(db,30000,inboxId);assert.ok(crashed);
  await db.$executeRaw`INSERT INTO "InboxNotification" ("id","ownerId","eventId") VALUES (${inboxId},${owner.id}::uuid,${eventId})`;
  await db.$executeRaw`UPDATE "NotificationDelivery" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "outboxId"=${inboxId}`;
  assert.equal((await deliverAlert(db,undefined,inboxId)).state,'DELIVERED');assert.equal((await db.$queryRaw`SELECT "id" FROM "InboxNotification" WHERE "id"=${inboxId}`).length,1);
  const attempts=await db.$queryRaw`SELECT * FROM "NotificationAttempt" WHERE "outboxId"=${email}`;assert.equal(attempts.length,8);assert.ok(!JSON.stringify(attempts).includes('secret-provider-response'));
  await assert.rejects(db.$executeRaw`DELETE FROM "NotificationOutbox" WHERE "id"=${email}`);await assert.rejects(db.$executeRaw`DELETE FROM "AlertEvent" WHERE "id"=${eventId}`);await assert.rejects(db.$executeRaw`DELETE FROM "NotificationAttempt" WHERE "id"=${attempts[0].id}::uuid`);
 }finally{await db.$disconnect()}
});
