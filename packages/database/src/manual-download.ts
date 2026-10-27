import {ownerBrokerBinding} from './broker-configuration.js';
import {manualDownloadProgress} from './manual-download-progress.js';
import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
import {readDownloadPreview} from './download-preview.js';
import {readDownloadPreviewProof,verifyDownloadPreview,authorizeDownloadPreview} from './download-authorization.js';
/** Durable owner-scoped acceptance; dispatch uses the existing backfill worker. */
export async function acceptManualDownload(db:PrismaClient,ownerId:string,input:{previewToken:string;mode:'MISSING_ONLY'|'RECONCILE';idempotencyKey:string},key:Uint8Array,accountKey:string){
 if(!input||typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.length>128)throw new Error('INVALID_DOWNLOAD_IDEMPOTENCY_KEY');
 const proof=readDownloadPreviewProof(input.previewToken,ownerId,key);
 if(input.mode!==proof.request.mode)throw new Error('DOWNLOAD_MODE_MISMATCH');
 const requestHash=createHash('sha256').update(canonical({accountKey,request:proof.request,binding:proof.binding})).digest('hex');
 for(let attempt=0;attempt<4;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},145))`;
  const binding=await ownerBrokerBinding(tx,ownerId,accountKey);if(binding.accountKey!==accountKey)throw new Error('DOWNLOAD_PREVIEW_CHANGED');
  const prior=await tx.$queryRaw<{requestHash:string;runId:string}[]>`SELECT "requestHash","runId" FROM "ManualDownloadSubmission" WHERE "ownerId"=${ownerId}::uuid AND "key"=${input.idempotencyKey}`;
  if(prior[0]){if(prior[0].requestHash!==requestHash)throw new Error('DOWNLOAD_IDEMPOTENCY_CONFLICT');return {runId:prior[0].runId,reused:true}}
  verifyDownloadPreview(input.previewToken,ownerId,key);
  const existing=await tx.$queryRaw<{id:string;configurationRevision:string|null}[]>`SELECT "id","evidence"->>'brokerConfigurationRevision' AS "configurationRevision" FROM "ManualDownloadRun" WHERE "ownerId"=${ownerId}::uuid AND "requestHash"=${requestHash} AND "state" IN ('QUEUED','RUNNING','PAUSED_AUTH','PAUSED_QUOTA','CANCEL_REQUESTED','PARTIAL')`;
  if(existing[0]&&existing[0].configurationRevision!==binding.configurationRevision)throw new Error('DOWNLOAD_PREVIEW_CHANGED');
  const runId=existing[0]?.id??randomUUID();
  if(!existing.length){
   const current=await readDownloadPreview(tx,ownerId,proof.request,accountKey);authorizeDownloadPreview(input.previewToken,ownerId,key,current);
   const evidence=canonical({accountKey,brokerConfigurationRevision:current.brokerConfigurationRevision,request:proof.request,previewBinding:proof.binding,previewId:current.previewId,universeSnapshotId:current.universeSnapshotId,instrumentSnapshotId:current.instrumentSnapshotId,sourceSnapshotId:current.sourceSnapshotId,dataRevision:current.dataRevision,items:current.items,acceptedAt:new Date().toISOString()});
   await tx.$executeRaw`INSERT INTO "ManualDownloadRun" ("id","ownerId","requestHash","state","evidence") VALUES (${runId}::uuid,${ownerId}::uuid,${requestHash},'QUEUED',${evidence}::jsonb)`;
   await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${runId}::uuid,'QUEUED','{"reason":"USER_SUBMISSION_ACCEPTED"}'::jsonb)`;
  }
  await tx.$executeRaw`INSERT INTO "ManualDownloadSubmission" ("ownerId","key","requestHash","runId") VALUES (${ownerId}::uuid,${input.idempotencyKey},${requestHash},${runId}::uuid)`;
  return {runId,reused:!!existing.length};
 },{isolationLevel:'Serializable',timeout:60000})}catch(error){const retry=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2002'||error.code==='P2010'&&['40001','40P01'].includes(String(error.meta?.['code'])));if(!retry||attempt===3)throw error}
 throw new Error('DOWNLOAD_SUBMISSION_RETRY_EXHAUSTED');
}
export async function readManualDownload(db:PrismaClient,ownerId:string,runId:string){
 return db.$transaction(tx=>readManualDownloadSnapshot(tx,ownerId,runId),{isolationLevel:'RepeatableRead',timeout:60000});
}
async function readManualDownloadSnapshot(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string,runId:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 const rows=await db.$queryRaw<{id:string;state:string;createdAt:Date;evidence:{request:{fromDate:string;toDate:string;mode:string};previewBinding:string;universeSnapshotId:string;instrumentSnapshotId:string;sourceSnapshotId:string;dataRevision:string;items:{listingId:string;symbol:string;calendarId:string;excludedDates:{reason:string;to:string}[];rangesToFetch:{sessions:string[]}[]}[]}}[]>`SELECT "id","state","createdAt","evidence" FROM "ManualDownloadRun" WHERE "id"=${runId}::uuid AND "ownerId"=${ownerId}::uuid`;
 const row=rows[0];if(!row)throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 const events=await db.$queryRaw<{id:string;state:string;evidence:unknown;createdAt:Date}[]>`SELECT "id","state","evidence","createdAt" FROM "ManualDownloadEvent" WHERE "runId"=${runId}::uuid ORDER BY "createdAt","id"`;
 const windows=await db.$queryRaw<{state:string;count:number;attempts:string}[]>`SELECT w."state",count(*)::integer AS count,sum(w."attempts")::text AS attempts FROM "HistoricalSyncWindow" w JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${runId}::uuid GROUP BY w."state" ORDER BY w."state"`;
 const totals=await db.$queryRaw<{newCandles:string;revisedCandles:string;unchangedCandles:string}[]>`SELECT COALESCE(sum((a."evidence"->>'inserted')::bigint),0)::text AS "newCandles",COALESCE(sum((a."evidence"->>'revised')::bigint),0)::text AS "revisedCandles",COALESCE(sum((a."evidence"->>'unchanged')::bigint),0)::text AS "unchangedCandles" FROM "HistoricalSyncAttempt" a JOIN "HistoricalSyncWindow" w ON w."id"=a."windowId" JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${runId}::uuid`;
 const progress=await manualDownloadProgress(db,runId,row.evidence.request,row.evidence.items);
 return {progress,runId:row.id,status:row.state,createdAt:row.createdAt.toISOString(),request:row.evidence.request,previewBinding:row.evidence.previewBinding,universeSnapshotId:row.evidence.universeSnapshotId,instrumentSnapshotId:row.evidence.instrumentSnapshotId,sourceSnapshotId:row.evidence.sourceSnapshotId,dataRevision:row.evidence.dataRevision,items:row.evidence.items,windowCounts:windows,candleChanges:totals[0],events:events.map(e=>({...e,createdAt:e.createdAt.toISOString()})),dispatchAvailable:false,executable:false};
}
export async function listManualDownloads(db:PrismaClient,ownerId:string,cursor?:string){
 let before:{createdAt:string;id:string}|null=null;
 if(cursor){if(cursor.length>1000)throw new Error('INVALID_DOWNLOAD_CURSOR');try{before=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(!before||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(before.id)||!Number.isFinite(Date.parse(before.createdAt)))throw new Error()}catch{throw new Error('INVALID_DOWNLOAD_CURSOR')}}
 const rows=await db.$queryRaw<{id:string;state:string;createdAt:Date;evidence:{request:unknown}}[]>`SELECT "id","state","createdAt","evidence" FROM "ManualDownloadRun" WHERE "ownerId"=${ownerId}::uuid AND (${before?.id??null}::uuid IS NULL OR ("createdAt","id")<(${before?new Date(before.createdAt):null}::timestamptz,${before?.id??null}::uuid)) ORDER BY "createdAt" DESC,"id" DESC LIMIT 26`;
 const items=rows.slice(0,25).map(r=>({runId:r.id,status:r.state,createdAt:r.createdAt.toISOString(),request:r.evidence.request})),last=items.at(-1);
 return {items,nextCursor:rows.length>25&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.runId})).toString('base64url'):null};
}
