import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {exchangeDate} from '@vcp/domain';
import {verifiedCalendar,readiness,universeAt,type CalendarDay,type GateProof,type UniverseSnapshot} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {prepareEodScan,type EodScanRequest} from './eod-scan.js';
export interface SchedulerLease {scope:string;ownerId:string;fence:string}
export function calendarScheduleDecision(days:readonly CalendarDay[]|null,asOf:string){
 const session=exchangeDate(asOf),day=days?.find(d=>d.date===session);
 if(!days||!day)return {state:'WAITING',reason:'CALENDAR_UNAVAILABLE',session};
 try{
  const calendar=verifiedCalendar(days,session,session,asOf);
  if(calendar.state!=='KNOWN')return {state:'WAITING',reason:'CALENDAR_UNVERIFIED',session};
  if(day.kind==='HOLIDAY')return {state:'SKIPPED',reason:'EXCHANGE_HOLIDAY',session};
  if(!calendar.sessions.length)return {state:'WAITING',reason:'SESSION_NOT_FINAL',session};
  return {state:'DUE',reason:null,session};
 }catch{return {state:'WAITING',reason:'INVALID_CALENDAR',session}}
}
export async function claimSchedulerLease(db:PrismaClient,ownerId:string,scope='eod',ttlMs=30000):Promise<SchedulerLease|null>{
 if(!/^[a-z0-9-]{1,80}$/.test(scope)||!Number.isSafeInteger(ttlMs)||ttlMs<100||ttlMs>60000)throw new Error('INVALID_SCHEDULER_LEASE');
 const rows=await db.$queryRaw<{fence:bigint}[]>`INSERT INTO "SchedulerLease" ("scope","ownerId","fence","expiresAt") VALUES (${scope},${ownerId}::uuid,1,clock_timestamp()+${ttlMs}*interval '1 millisecond') ON CONFLICT ("scope") DO UPDATE SET "ownerId"=EXCLUDED."ownerId","fence"=CASE WHEN "SchedulerLease"."ownerId"=EXCLUDED."ownerId" AND "SchedulerLease"."expiresAt">clock_timestamp() THEN "SchedulerLease"."fence" ELSE "SchedulerLease"."fence"+1 END,"expiresAt"=EXCLUDED."expiresAt" WHERE "SchedulerLease"."ownerId"=EXCLUDED."ownerId" OR "SchedulerLease"."expiresAt"<=clock_timestamp() RETURNING "fence"`;
 return rows[0]?{scope,ownerId,fence:rows[0].fence.toString()}:null;
}
export async function releaseSchedulerLease(db:PrismaClient,lease:SchedulerLease){return db.$executeRaw`UPDATE "SchedulerLease" SET "expiresAt"=clock_timestamp() WHERE "scope"=${lease.scope} AND "ownerId"=${lease.ownerId}::uuid AND "fence"=${BigInt(lease.fence)}`}
export async function scheduleCalendarTick(db:PrismaClient,lease:SchedulerLease){
 return db.$transaction(async tx=>{
  const owners=await tx.$queryRaw<{scope:string}[]>`SELECT "scope" FROM "SchedulerLease" WHERE "scope"=${lease.scope} AND "ownerId"=${lease.ownerId}::uuid AND "fence"=${BigInt(lease.fence)} AND "expiresAt">clock_timestamp() FOR UPDATE`;
  if(!owners[0])throw new Error('SCHEDULER_LEASE_LOST');
  const time=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`,at=time[0]!.now,asOf=at.toISOString();
  const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=${at} ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const calendar=calendars[0],decision=calendarScheduleDecision(calendar?.evidence??null,asOf);
  const record=async(state:string,reason:string|null,scanId:string|null=null)=>{
   // A paused/expired owner cannot publish status or create a request after losing its lease.
   const held=await tx.$queryRaw<{scope:string}[]>`SELECT "scope" FROM "SchedulerLease" WHERE "scope"=${lease.scope} AND "ownerId"=${lease.ownerId}::uuid AND "fence"=${BigInt(lease.fence)} AND "expiresAt">clock_timestamp()`;
   if(!held[0])throw new Error('SCHEDULER_LEASE_LOST');
   const result={scope:lease.scope,session:decision.session,state,reason,scanId,asOf,calendarId:calendar?.id??null,fence:lease.fence};
   await tx.$executeRaw`INSERT INTO "SchedulerStatus" ("scope","evidence") VALUES (${lease.scope},${canonical(result)}::jsonb) ON CONFLICT ("scope") DO UPDATE SET "evidence"=EXCLUDED."evidence","checkedAt"=clock_timestamp()`;return result;
  };
  const existing=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ScheduledScanRequest" WHERE "scope"=${lease.scope} AND "session"=${new Date(decision.session)}`;
  if(existing[0])return record('SCHEDULED',null,existing[0].id);
  if(decision.state!=='DUE')return record(decision.state,decision.reason);
  const proofs=await tx.$queryRaw<{evidence:GateProof}[]>`SELECT DISTINCT ON ("gate") "evidence" FROM "ReadinessProof" WHERE "gate" IN ('G02','G03') AND "probeAt"<=${at} ORDER BY "gate","probeAt" DESC,"id"`;
  const gates=readiness(proofs.map(r=>r.evidence),asOf);
  for(const gate of ['G02','G03'])if(gates.items.find(g=>g.gate===gate)?.status!=='PASS')return record('WAITING',gate+'_NOT_READY');
  const profiles=await tx.$queryRaw<{profileId:string}[]>`SELECT "profileId" FROM "StrategyActivation" WHERE "activatedAt"<=${at} AND "knownAt"<=${at} ORDER BY "activatedAt" DESC,"knownAt" DESC,"id" DESC LIMIT 1`;
  if(!profiles[0])return record('WAITING','SCAN_ACTIVE_PROFILE_UNAVAILABLE');
  const universes=await tx.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`;
  const universe=universeAt(universes.map(u=>u.evidence),asOf);if(universe.state!=='KNOWN'||!universe.members.length)return record('WAITING','SCAN_VERIFIED_UNIVERSE_UNAVAILABLE');
  const request:EodScanRequest={scanId:randomUUID(),session:decision.session,calendarId:calendar!.id,asOf};
  // Transaction rollback also removes this request if the fence expires before the final check.
  await tx.$executeRaw`INSERT INTO "ScheduledScanRequest" ("id","scope","session","evidence") VALUES (${request.scanId}::uuid,${lease.scope},${new Date(request.session)},${canonical(request)}::jsonb)`;
  return record('SCHEDULED',null,request.scanId);
 },{timeout:15000});
}
export async function prepareScheduledScan(db:PrismaClient,scanId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scanId))throw new Error('INVALID_SCHEDULED_SCAN_ID');
 const rows=await db.$queryRaw<{evidence:EodScanRequest}[]>`SELECT "evidence" FROM "ScheduledScanRequest" WHERE "id"=${scanId}::uuid`;
 if(!rows[0])throw new Error('SCHEDULED_SCAN_NOT_FOUND');
 try{const plan=await prepareEodScan(db,rows[0].evidence);return {scanId,dataRevision:plan.dataRevision,intended:plan.items.length,state:'PREPARED'}}catch(error){
  const reason=error instanceof Error&&/^(SCAN_[A-Z_]+|INVALID_SCAN_REQUEST)$/.test(error.message)?error.message:'SCAN_PREPARATION_FAILED';
  await db.$executeRaw`INSERT INTO "ScheduledScanDispatch" ("scanId","state","reason") VALUES (${scanId}::uuid,'FAILED',${reason}) ON CONFLICT ("scanId") DO UPDATE SET "state"='FAILED',"reason"=EXCLUDED."reason","checkedAt"=clock_timestamp()`;
  throw new Error(reason,{cause:error});
 }
}
export async function pendingScheduledScans(db:PrismaClient){return db.$queryRaw<{id:string}[]>`SELECT r."id" FROM "ScheduledScanRequest" r LEFT JOIN "ScheduledScanDispatch" d ON d."scanId"=r."id" WHERE NOT EXISTS (SELECT 1 FROM "EodScanPlan" p WHERE p."id"=r."id") ORDER BY COALESCE(d."checkedAt",r."createdAt"),r."id" LIMIT 25`}
export async function recordScheduledDispatch(db:PrismaClient,id:string,state:string){await db.$executeRaw`INSERT INTO "ScheduledScanDispatch" ("scanId","state") VALUES (${id}::uuid,${state}) ON CONFLICT ("scanId") DO UPDATE SET "state"=EXCLUDED."state","checkedAt"=clock_timestamp()`}
export async function schedulerStatus(db:PrismaClient,scope='eod'){
 const rows=await db.$queryRaw<{evidence:unknown;checkedAt:Date}[]>`SELECT "evidence","checkedAt" FROM "SchedulerStatus" WHERE "scope"=${scope}`;
 const requests=await db.$queryRaw<{id:string;session:Date;state:string|null;reason:string|null}[]>`SELECT r."id",r."session",CASE WHEN p."id" IS NOT NULL THEN 'PREPARED' ELSE d."state" END AS state,CASE WHEN p."id" IS NOT NULL THEN NULL ELSE d."reason" END AS reason FROM "ScheduledScanRequest" r LEFT JOIN "ScheduledScanDispatch" d ON d."scanId"=r."id" LEFT JOIN "EodScanPlan" p ON p."id"=r."id" WHERE r."scope"=${scope} ORDER BY r."session" DESC LIMIT 10`;
 return {status:rows[0]??{evidence:{state:'UNKNOWN',reason:'SCHEDULER_NOT_OBSERVED'},checkedAt:null},requests};
}
