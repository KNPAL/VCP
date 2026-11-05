import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {appendAlert,deliverAlert,PrismaClient} from '../packages/database/dist/index.js';
test('killing the delivery worker after a committed claim preserves one signal and recovers exactly one inbox delivery',{timeout:90000},async()=>{
 const fixture=await isolatedDatabase('recovery'),db=fixture.db;
 let child,restarted;
 try{
  const owner=await db.owner.findFirstOrThrow(),now=new Date().toISOString(),id=createHash('sha256').update(randomUUID()).digest('hex');
  const event={id,sourceEventId:id,kind:'SELL',sourceAt:now,occurredAt:now,decidedAt:now,effectiveAt:now,strategyVersion:'ST_VCP_4_0',configHash:'a'.repeat(64),dataRevision:'recovery-test',executable:false};
  await db.$transaction(tx=>appendAlert(tx,event,[owner.id]));
  const outbox=await db.notificationOutbox.findFirstOrThrow({where:{eventId:id}});
  const url=new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema',(await db.$queryRaw`SELECT current_schema() AS name`)[0].name);
  child=fork(new URL('../fixtures/crash-after-alert-claim.mjs',import.meta.url),[outbox.id],{env:{...process.env,DATABASE_URL:url.href},stdio:['ignore','ignore','inherit','ipc']});
  const exited=once(child,'exit');
  const [message]=await Promise.race([once(child,'message'),exited.then(()=>{throw Error('Worker exited before claiming')})]);
  assert.ok(message.claimed);child.kill('SIGKILL');await exited;
  restarted=new PrismaClient({datasources:{db:{url:url.href}}});
  assert.equal((await deliverAlert(restarted,undefined,outbox.id)).state,'IDLE');
  await db.$executeRaw`UPDATE "NotificationDelivery" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "outboxId"=${outbox.id}`;
  assert.equal((await deliverAlert(restarted,undefined,outbox.id)).state,'DELIVERED');
  assert.equal((await deliverAlert(restarted,undefined,outbox.id)).state,'IDLE');
  assert.equal(await db.inboxNotification.count({where:{eventId:id}}),1);
  assert.equal(await db.alertEvent.count({where:{id}}),1);
  assert.equal(await db.portfolioJournal.count(),0);
 }finally{if(child?.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await restarted?.$disconnect();await fixture.close()}
});
