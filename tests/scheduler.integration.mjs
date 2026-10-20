import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient,claimSchedulerLease,releaseSchedulerLease,scheduleCalendarTick,schedulerStatus,persistReadiness,persistUniverse,persistInstrumentSnapshot,registerProfile,activateProfile,getScan,eodScanProgress} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {exchangeDate} from '../packages/domain/dist/index.js';
import {queue,createWorker} from '../apps/worker/dist/runtime.js';
import {dispatchScheduledScans,scheduledScanHandler} from '../apps/worker/dist/scheduler.js';
import {dispatchEodScans,eodScanHandler} from '../apps/worker/dist/eod-scan.js';
process.env.REDIS_PORT??='56379';
const db=new PrismaClient();
test('scheduler fences stale owners, persists one session request and recovers queued preparation',async()=>{
 let q,worker;
 try{
  const scope='test-'+randomUUID(),ownerA=randomUUID(),ownerB=randomUUID();
  const lease=await claimSchedulerLease(db,ownerA,scope);assert.ok(lease);assert.equal(await claimSchedulerLease(db,ownerB,scope),null);
  assert.equal((await claimSchedulerLease(db,ownerA,scope)).fence,lease.fence);
  const now=Date.now(),at=new Date(now).toISOString(),session=exchangeDate(at);
  const calendar=[{date:session,kind:'SPECIAL',opensAt:new Date(now-60000).toISOString(),closesAt:new Date(now-30000).toISOString(),finalizedAt:new Date(now-10000).toISOString(),knownAt:new Date(now-120000).toISOString(),source:'synthetic-scheduler',verified:true}];
  const calendarId=createHash('sha256').update(JSON.stringify(calendar)).digest('hex');await db.calendarSnapshot.create({data:{id:calendarId,evidence:calendar}});
  const proof=async(gate,status)=>{const probeAt=new Date().toISOString();return persistReadiness(db,{gate,status,probeAt,sourceAt:probeAt,expiresAt:new Date(Date.now()+3600000).toISOString(),sourceReference:'synthetic-scheduler',reason:status==='PASS'?null:'DATA_INCOMPLETE',details:{synthetic:true}})};
  await proof('G02','FAIL');assert.equal((await scheduleCalendarTick(db,lease)).reason,'G02_NOT_READY');
  await proof('G02','PASS');await proof('G03','PASS');
  const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0),activeAt=new Date().toISOString();await activateProfile(db,profile.id,activeAt,activeAt);
  await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-empty-mapping',rows:[]});
  await persistUniverse(db,{universe:'NIFTY_500',knownAt:new Date().toISOString(),effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-scheduler',historicalConstituentsVerified:true,isins:['INE000000001']});
  const [first,duplicate]=await Promise.all([scheduleCalendarTick(db,lease),scheduleCalendarTick(db,lease)]);assert.equal(first.state,'SCHEDULED');assert.equal(first.scanId,duplicate.scanId);
  assert.equal((await db.$queryRaw`SELECT "id" FROM "ScheduledScanRequest" WHERE "scope"=${scope}`).length,1);
  assert.equal(await eodScanProgress(db,first.scanId),null); // scheduling never computes a scan in this transaction
  await db.$executeRaw`UPDATE "SchedulerLease" SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE "scope"=${scope}`;
  await assert.rejects(scheduleCalendarTick(db,lease),/SCHEDULER_LEASE_LOST/);
  const next=await claimSchedulerLease(db,ownerB,scope);assert.ok(BigInt(next.fence)>BigInt(lease.fence));assert.equal(await releaseSchedulerLease(db,lease),0);
  await assert.rejects(scheduleCalendarTick(db,lease),/SCHEDULER_LEASE_LOST/);assert.equal((await scheduleCalendarTick(db,next)).scanId,first.scanId);
  q=queue('scheduler-'+randomUUID());await dispatchScheduledScans(db,q);
  const lost=(await q.getJobs(['waiting'])).find(j=>j.data.scanId===first.scanId);assert.ok(lost);await lost.remove();await dispatchScheduledScans(db,q);assert.ok(await q.getJob(lost.id));
  worker=createWorker(q.name,{'eod-prepare':scheduledScanHandler(db),'eod-scan':eodScanHandler(db)});
  let deadline=Date.now()+20000;while(Date.now()<deadline&&!await eodScanProgress(db,first.scanId))await new Promise(r=>setTimeout(r,50));
  assert.ok(await eodScanProgress(db,first.scanId));assert.equal((await schedulerStatus(db,scope)).requests[0].state,'PREPARED');
  await dispatchEodScans(db,q);deadline=Date.now()+20000;while(Date.now()<deadline&&!await getScan(db,first.scanId))await new Promise(r=>setTimeout(r,50));
  const scan=await getScan(db,first.scanId);assert.equal(scan.status,'ERROR');assert.equal(scan.counts.missing,1);
  const renewed=await claimSchedulerLease(db,ownerB,scope);assert.equal((await scheduleCalendarTick(db,renewed)).scanId,first.scanId);
  await assert.rejects(db.$executeRaw`DELETE FROM "ScheduledScanRequest" WHERE "id"=${first.scanId}::uuid`);
  await releaseSchedulerLease(db,renewed);
 }finally{if(worker)await worker.close();if(q){await q.obliterate({force:true});await q.close()}await db.$disconnect()}
});
