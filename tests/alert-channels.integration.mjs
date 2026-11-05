import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {appendAlert,deliverAlert,browserDelivery,finishBrowserDelivery,readInbox,reviewInbox,setAlertPreference} from '../packages/database/dist/index.js';
import {emailAdapter} from '../apps/worker/dist/email-alert.js';

test('owner preferences, urgent browser claims, provider retries and durable inbox review',async()=>{
 const fixture=await isolatedDatabase('alert_channels'),db=fixture.db;
 try{
  const owner=await db.owner.findFirstOrThrow(),other={id:randomUUID()};
  async function record(kind){
   const id=createHash('sha256').update(randomUUID()).digest('hex'),at=new Date().toISOString();
   await db.$transaction(tx=>appendAlert(tx,{id,kind,sourceEventId:id,quantity:7,occurredAt:at,sourceAt:at,decidedAt:at,effectiveAt:at,configHash:id,strategyVersion:'test',dataRevision:'fixture',executable:false},[owner.id]));
   return db.notificationOutbox.findMany({where:{eventId:id}});
  }
  assert.deepEqual((await record('WATCH')).map(o=>o.channel),['IN_APP']);
  await setAlertPreference(db,owner.id,'BROWSER',true);
  await setAlertPreference(db,owner.id,'EMAIL',true);
  await record('WATCH');
  const rows=await record('SELL');
  assert.equal(rows.length,3);
  assert.equal(await browserDelivery(db,other.id),null);
  const browser=await browserDelivery(db,owner.id);
  assert.equal(browser.kind,'SELL');
  assert.equal(await finishBrowserDelivery(db,other.id,browser.id,browser.token,true),false);
  assert.equal(await finishBrowserDelivery(db,owner.id,browser.id,browser.token,true),true);
  assert.equal(await finishBrowserDelivery(db,owner.id,browser.id,browser.token,true),false);
  await setAlertPreference(db,owner.id,'BROWSER',false);
  assert.equal(await browserDelivery(db,owner.id),null);
  const email=rows.find(o=>o.channel==='EMAIL'),inbox=rows.find(o=>o.channel==='IN_APP');
  const keys=[];
  const adapter=emailAdapter(db,{VCP_ALERT_EMAIL_OWNER:owner.id,VCP_ALERT_EMAIL_TO:'fixture@example.invalid',VCP_ALERT_EMAIL_FROM:'fixture@example.invalid',VCP_ALERT_EMAIL_KEY_FILE:'package.json'},async(url,request)=>{
   assert.equal(url,'https://api.resend.com/emails');keys.push(request.headers['Idempotency-Key']);
   return Response.json({id:'test-receipt'},{status:keys.length===1?503:200});
  });
  assert.equal((await deliverAlert(db,adapter,email.id)).state,'RETRY_OR_FAILED');
  await db.$executeRaw`UPDATE "NotificationDelivery" SET "nextAttemptAt"=clock_timestamp() WHERE "outboxId"=${email.id}`;
  assert.equal((await deliverAlert(db,adapter,email.id)).state,'DELIVERED');
  assert.deepEqual(keys,[email.id,email.id]);
  assert.equal((await deliverAlert(db,undefined,inbox.id)).state,'DELIVERED');
  assert.equal(await reviewInbox(db,other.id,inbox.id,'DISMISSED'),false);
  for(const kind of ['ACKNOWLEDGED','ACKNOWLEDGED','DISMISSED'])assert.equal(await reviewInbox(db,owner.id,inbox.id,kind),true);
  const item=(await readInbox(db,owner.id)).items[0];
  assert.equal(item.quantity,'7');assert.ok(item.acknowledged&&item.dismissed);
  assert.equal(item.channels.length,3);assert.ok(item.channels.every(c=>c.attemptedAt&&c.deliveredAt));
  assert.equal((await readInbox(db,other.id)).items.length,0);
 }finally{await fixture.close()}
});
