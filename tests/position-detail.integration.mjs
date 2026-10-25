import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {PrismaClient,readPortfolio,positionTimeline,readPositionDetail,acknowledgePositionAlert} from '../packages/database/dist/index.js';
const db=new PrismaClient(),hash=v=>createHash('sha256').update(v).digest('hex');
test('position timeline pages immutable evidence and acknowledgement never records or resolves an execution',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0'),stopId=hash(randomUUID()),episodeId=randomUUID(),at=new Date(Date.now()-120000).toISOString(),before=await readPortfolio(db,owner.id);
  const stop={id:stopId,isin,episodeId,fillId:episodeId,quantityAtCreation:2,state:'UNKNOWN',reason:'SYNTHETIC_TEST',stop:null,sourceId:null,configHash:'a'.repeat(64),recordedAt:at};
  await db.$executeRaw`INSERT INTO "InitialPositionStop" ("id","ownerId","isin","episodeId","evidence") VALUES (${stopId},${owner.id}::uuid,${isin},${episodeId}::uuid,${JSON.stringify(stop)}::jsonb)`;
  const signals=[];
  for(let i=0;i<60;i++){const id=hash(randomUUID()),session=new Date(Date.UTC(2025,0,i+1)),recognizedAt=new Date(Date.parse(at)+1000+i);signals.push(id);const evidence={id,isin,quantity:2,activeStop:'90',triggeredPrice:'89',recognizedAt:recognizedAt.toISOString(),observedTickAt:recognizedAt.toISOString(),scaleRevision:'synthetic'};await db.$executeRaw`INSERT INTO "ProtectiveSignal" ("id","ownerId","stopId","session","recognizedAt","evidence") VALUES (${id},${owner.id}::uuid,${stopId},${session},${recognizedAt},${JSON.stringify(evidence)}::jsonb)`}
  const first=await positionTimeline(db,owner.id,isin);assert.equal(first.items.length,50);assert.ok(first.nextCursor);
  const second=await positionTimeline(db,owner.id,isin,first.nextCursor);assert.equal(second.items.length,11);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(i=>i.kind+':'+i.id)).size,61);
  assert.deepEqual((await positionTimeline(db,randomUUID(),isin)).items,[]);await assert.rejects(positionTimeline(db,owner.id,'INE000000001',first.nextCursor),/INVALID_TIMELINE_CURSOR/);await assert.rejects(positionTimeline(db,owner.id,isin,'broken'),/INVALID_TIMELINE_CURSOR/);
  const [a,b]=await Promise.all([acknowledgePositionAlert(db,owner.id,signals[0],'Reviewed synthetic evidence'),acknowledgePositionAlert(db,owner.id,signals[0],'Reviewed synthetic evidence')]);assert.deepEqual(a,b);assert.equal(a.executionRecorded,false);assert.equal(a.executable,false);
  await assert.rejects(acknowledgePositionAlert(db,owner.id,signals[0],'Changed note'),/STALE_CONFLICT/);await assert.rejects(acknowledgePositionAlert(db,randomUUID(),signals[0],'Other owner'),/POSITION_ALERT_NOT_FOUND/);
  const timeline=await positionTimeline(db,owner.id,isin);assert.equal(timeline.items[0].kind,'ACKNOWLEDGEMENT');assert.equal(timeline.items[0].evidence.signalId,signals[0]);
  const resolutions=await db.$queryRaw`SELECT "id" FROM "ExitResolution" WHERE "signalId"=${signals[0]}`;assert.equal(resolutions.length,0);
  const detail=await readPositionDetail(db,owner.id,isin);assert.equal(detail.current,null);assert.deepEqual(detail.events,[]);assert.equal(detail.executable,false);
  assert.deepEqual((await readPortfolio(db,owner.id)).events,before.events);await assert.rejects(db.$executeRaw`UPDATE "PositionAlertAcknowledgement" SET "isin"='changed' WHERE "id"=${a.id}`);await assert.rejects(db.$executeRaw`DELETE FROM "PositionAlertAcknowledgement" WHERE "id"=${a.id}`);
 }finally{await db.$disconnect()}
});
