import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,observePattern,patternHistory,registerProfile} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {detect} from '../packages/vcp/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
const db=new PrismaClient();
test('live pattern transitions are atomic, exact and immutable across rescans and corrections',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0),series=goldenSeries(),base=detect(series,{listingId:randomUUID(),tick:'0.05',adjustmentRevision:'synthetic',currentScaleFactor:'1',rs:'85',decidedAt:series.asOf}).primary;assert.ok(base);
  const at=day=>`2026-10-${String(day).padStart(2,'0')}T10:00:00Z`,pattern=(day,state)=>({...base,state,asOf:at(day),decidedAt:at(day),pivot:'100.123456',dataRevision:'synthetic-r'+day,reasons:state==='WATCH_DATA'?['VDU_UNKNOWN']:[]});
  const first=pattern(1,'WATCH');const duplicates=await Promise.all([1,2].map(()=>db.$transaction(tx=>observePattern(tx,first,'2026-10-01',profile.id))));assert.equal(duplicates.filter(r=>r.changed).length,1);
  for(const [day,state] of [[2,'WATCH'],[3,'READY'],[4,'WATCH_DATA'],[5,'INVALIDATED'],[6,'EXPIRED']])await db.$transaction(tx=>observePattern(tx,pattern(day,state),at(day).slice(0,10),profile.id));
  const before=await patternHistory(db,base.id);assert.equal(before.observations.length,6);assert.equal(before.transitions.length,5);assert.deepEqual(before.transitions.map(e=>e.to),['WATCH','READY','BLOCKED_DATA','INVALIDATED','EXPIRED']);assert.equal(before.transitions[0].from,'DISCOVERED');assert.equal(before.transitions[1].from,'WATCH');assert.equal(before.observations[0].pattern.pivot,'100.123456');assert.equal(before.transitions[2].occurredAt,at(4));assert.deepEqual(before.transitions[2].reasons,['VDU_UNKNOWN']);
  await assert.rejects(db.$transaction(tx=>observePattern(tx,{...first,pivot:'101.123456'},'2026-10-01',profile.id)),/IMMUTABLE/);
  await assert.rejects(db.$transaction(tx=>observePattern(tx,pattern(7,'READY'),'2026-10-07',profile.id)),/TERMINAL/);
  await assert.rejects(db.$transaction(tx=>observePattern(tx,{...first,asOf:'2026-09-30T10:00:00Z',decidedAt:'2026-09-30T10:00:00Z'},'2026-09-30',profile.id)),/OUT_OF_ORDER/);
  assert.deepEqual(await patternHistory(db,base.id),before);
  for(const transition of before.transitions){const outbox=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${transition.id}`;assert.equal(outbox.length,1)}
  await assert.rejects(db.$executeRaw`DELETE FROM "PatternTransition" WHERE "id"=${before.transitions[0].id}`);
  assert.equal((await patternHistory(db,'f'.repeat(64))).state,'UNKNOWN');
 }finally{await db.$disconnect()}
});
