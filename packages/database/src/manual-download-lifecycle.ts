import {randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {verifiedCalendar,dateAfter,type CalendarDay} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readDownloadPreview,type DownloadPreviewRequest} from './download-preview.js';
import {readBrokerHealth} from './data-health.js';
type Evidence={brokerConfigurationRevision?:string|null;accountKey:string;request:DownloadPreviewRequest;instrumentSnapshotId:string;universeSnapshotId:string;sourceSnapshotId:string;items:{listingId:string;calendarId:string;excludedDates:{from:string;to:string;reason:string}[]}[]};
async function transition(tx:Prisma.TransactionClient,id:string,from:string,to:string,reason:string){
 if(from===to)return;
 await tx.$executeRaw`UPDATE "ManualDownloadRun" SET "state"=${to} WHERE "id"=${id}::uuid`;
 await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${id}::uuid,${to},${canonical({reason})}::jsonb)`;
}
export async function cancelManualDownload(db:PrismaClient,ownerId:string,runId:string,key:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 if(typeof key!=='string'||!key.trim()||key.length>128)throw new Error('INVALID_DOWNLOAD_IDEMPOTENCY_KEY');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},145))`;
  const runs=await tx.$queryRaw<{state:string}[]>`SELECT "state" FROM "ManualDownloadRun" WHERE "id"=${runId}::uuid AND "ownerId"=${ownerId}::uuid FOR UPDATE`;
  const run=runs[0];if(!run)throw new Error('DOWNLOAD_RUN_NOT_FOUND');
  const receipts=await tx.$queryRaw<{runId:string;action:string}[]>`SELECT "runId","action" FROM "ManualDownloadAction" WHERE "ownerId"=${ownerId}::uuid AND "key"=${key}`;
  if(receipts[0]&&(receipts[0].runId!==runId||receipts[0].action!=='CANCEL'))throw new Error('DOWNLOAD_IDEMPOTENCY_CONFLICT');
  if(!receipts.length)await tx.$executeRaw`INSERT INTO "ManualDownloadAction" ("ownerId","key","runId","action") VALUES (${ownerId}::uuid,${key},${runId}::uuid,'CANCEL')`;
  if(['COMPLETED','CANCELLED'].includes(run.state))return {runId,status:run.state};
  const active=await tx.$queryRaw<{id:string}[]>`SELECT w."id" FROM "HistoricalSyncWindow" w JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${runId}::uuid AND w."state"='RUNNING' AND w."leaseUntil">clock_timestamp()`;
  const status=active.length?'CANCEL_REQUESTED':'CANCELLED';await transition(tx,runId,run.state,status,'USER_CANCELLED');return {runId,status};
 });
}
export async function retryManualDownload(db:PrismaClient,ownerId:string,runId:string,key:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 if(typeof key!=='string'||!key.trim()||key.length>128)throw new Error('INVALID_DOWNLOAD_IDEMPOTENCY_KEY');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},145))`;
  const runs=await tx.$queryRaw<{state:string;evidence:Evidence}[]>`SELECT "state","evidence" FROM "ManualDownloadRun" WHERE "id"=${runId}::uuid AND "ownerId"=${ownerId}::uuid FOR UPDATE`;
  const run=runs[0];if(!run)throw new Error('DOWNLOAD_RUN_NOT_FOUND');
  const receipts=await tx.$queryRaw<{runId:string;action:string}[]>`SELECT "runId","action" FROM "ManualDownloadAction" WHERE "ownerId"=${ownerId}::uuid AND "key"=${key}`;
  if(receipts[0]){if(receipts[0].runId!==runId||receipts[0].action!=='RETRY')throw new Error('DOWNLOAD_IDEMPOTENCY_CONFLICT');return {runId,status:run.state}}
  if(!['PAUSED_AUTH','PAUSED_QUOTA','PARTIAL','FAILED'].includes(run.state))throw new Error('DOWNLOAD_NOT_RETRYABLE');
  const active=await tx.$queryRaw<{id:string}[]>`SELECT w."id" FROM "HistoricalSyncWindow" w JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${runId}::uuid AND w."state"='RUNNING' AND w."leaseUntil">clock_timestamp()`;
  if(active.length)throw new Error('DOWNLOAD_REQUEST_STILL_RUNNING');
  if(run.state==='PAUSED_QUOTA'){const waits=await tx.$queryRaw<{id:string}[]>`SELECT w."id" FROM "HistoricalSyncWindow" w JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${runId}::uuid AND c."generation"=(SELECT max(other."generation") FROM "ManualDownloadChild" other WHERE other."manualRunId"=${runId}::uuid) AND w."reason"='RATE_LIMITED' AND w."nextAttemptAt">clock_timestamp()`;if(waits.length)throw new Error('DOWNLOAD_QUOTA_WAIT')}
  const current=await readDownloadPreview(tx,ownerId,run.evidence.request,run.evidence.accountKey);
  if(current.brokerConfigurationRevision!==(run.evidence.brokerConfigurationRevision??null))throw new Error('DOWNLOAD_PREVIEW_CHANGED');
  if(current.instrumentSnapshotId!==run.evidence.instrumentSnapshotId||current.universeSnapshotId!==run.evidence.universeSnapshotId||current.sourceSnapshotId!==run.evidence.sourceSnapshotId)throw new Error('DOWNLOAD_PREVIEW_CHANGED');
  if(!current.items.length||current.blockedInstruments.length||current.items.some(i=>i.state!=='KNOWN')||Object.values(current.sourcePermissions).some(p=>p.status!=='PASS')||current.warnings.includes('BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'))throw new Error('DOWNLOAD_PREREQUISITES_UNAVAILABLE');
  await tx.$executeRaw`INSERT INTO "ManualDownloadAction" ("ownerId","key","runId","action") VALUES (${ownerId}::uuid,${key},${runId}::uuid,'RETRY')`;
  await transition(tx,runId,run.state,'QUEUED','USER_RETRY_REQUESTED');return {runId,status:'QUEUED'};
 },{timeout:60000});
}
/** Reconcile a bounded set; completion requires both terminal windows and pinned-calendar coverage. */
export async function reconcileManualDownloads(db:PrismaClient){
 return db.$transaction(async tx=>{
  const runs=await tx.$queryRaw<{id:string;state:string;evidence:Evidence}[]>`SELECT "id","state","evidence" FROM "ManualDownloadRun" WHERE "state" IN ('RUNNING','PAUSED_QUOTA','CANCEL_REQUESTED') ORDER BY "createdAt","id" LIMIT 25 FOR UPDATE SKIP LOCKED`;
  const result=[];
  for(const run of runs){
   const windows=await tx.$queryRaw<{state:string;active:boolean;reason:string|null;nextAttemptAt:Date}[]>`SELECT w."state",w."reason",w."nextAttemptAt",COALESCE(w."leaseUntil">clock_timestamp(),false) AS active FROM "HistoricalSyncWindow" w JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${run.id}::uuid AND c."generation"=(SELECT max(other."generation") FROM "ManualDownloadChild" other WHERE other."manualRunId"=${run.id}::uuid)`;
   let status=run.state,reason='WINDOWS_PENDING';
   if(run.state==='CANCEL_REQUESTED'){if(!windows.some(w=>w.state==='RUNNING'&&w.active)){status='CANCELLED';reason='ACTIVE_REQUEST_FINISHED'}}
   else if(windows.some(w=>['PENDING','PARTIAL','RUNNING','FAILED'].includes(w.state))){
    const broker=await readBrokerHealth(tx,run.evidence.accountKey);
    if(!broker.authenticated){status='PAUSED_AUTH';reason='BROKER_SESSION_UNAVAILABLE'}
    else if(!broker.historyReady){status='PARTIAL';reason='DOWNLOAD_READINESS_UNAVAILABLE'}
    else if(!windows.some(w=>['PENDING','PARTIAL','RUNNING'].includes(w.state))){status='PARTIAL';reason='WINDOWS_INCOMPLETE'}
    else{const pending=windows.filter(w=>['PENDING','PARTIAL','RUNNING'].includes(w.state));const waiting=pending.every(w=>w.state==='PARTIAL'&&w.reason==='RATE_LIMITED'&&w.nextAttemptAt.valueOf()>Date.now());status=waiting?'PAUSED_QUOTA':'RUNNING';reason=waiting?'ACCOUNT_QUOTA_WAIT':'ACCOUNT_QUOTA_WAIT_FINISHED'}
   }
   else if(!windows.length||windows.some(w=>!['COMPLETE','SPLIT'].includes(w.state))){status='PARTIAL';reason='WINDOWS_INCOMPLETE'}
   else{
    let complete=run.evidence.items.length>0;const now=new Date().toISOString();
    for(const item of run.evidence.items){
     const calendars=await tx.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${item.calendarId}`;
     const excluded=item.excludedDates.find(d=>d.reason==='BEFORE_LISTING'),from=excluded?dateAfter(excluded.to,1):run.evidence.request.fromDate;
     const expected=verifiedCalendar(calendars[0]?.evidence??null,from,run.evidence.request.toDate,now);
     const stored=await tx.$queryRaw<{session:Date;finalizedAt:Date}[]>`SELECT "session","finalizedAt" FROM "RawDailyCandle" WHERE "listingId"=${item.listingId}::uuid AND "provider"='ANGEL_ONE' AND "session">=${new Date(from)} AND "session"<=${new Date(run.evidence.request.toDate)} AND "receivedAt"<=${new Date(now)} AND "finalizedAt"<=${new Date(now)}`;
     const bars=new Map(stored.map(b=>[b.session.toISOString().slice(0,10),b.finalizedAt.valueOf()]));
     if(expected.state!=='KNOWN'||expected.sessions.some(d=>!bars.has(d.date)||bars.get(d.date)!<Date.parse(d.finalizedAt!)))complete=false;
    }
    status=complete?'COMPLETED':'PARTIAL';reason=complete?'COVERAGE_VERIFIED':'COVERAGE_INCOMPLETE';
   }
   await transition(tx,run.id,run.state,status,reason);result.push({runId:run.id,status});
  }
  return result;
 },{timeout:60000});
}
