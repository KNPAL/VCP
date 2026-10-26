import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
import {readDownloadPreview} from './download-preview.js';
import {verifyDownloadPreview,authorizeDownloadPreview} from './download-authorization.js';
/** Internal durable acceptance only. Worker dispatch and public submission are not enabled yet. */
export async function acceptManualDownload(db:PrismaClient,ownerId:string,input:{previewToken:string;mode:'MISSING_ONLY'|'RECONCILE';idempotencyKey:string},key:Uint8Array,accountKey:string){
 if(!input||typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.length>128)throw new Error('INVALID_DOWNLOAD_IDEMPOTENCY_KEY');
 const proof=verifyDownloadPreview(input.previewToken,ownerId,key);
 if(input.mode!==proof.request.mode)throw new Error('DOWNLOAD_MODE_MISMATCH');
 const requestHash=createHash('sha256').update(canonical({accountKey,request:proof.request,binding:proof.binding})).digest('hex');
 for(let attempt=0;attempt<4;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},145))`;
  const prior=await tx.$queryRaw<{requestHash:string;runId:string}[]>`SELECT "requestHash","runId" FROM "ManualDownloadSubmission" WHERE "ownerId"=${ownerId}::uuid AND "key"=${input.idempotencyKey}`;
  if(prior[0]){if(prior[0].requestHash!==requestHash)throw new Error('DOWNLOAD_IDEMPOTENCY_CONFLICT');return {runId:prior[0].runId,reused:true}}
  const current=await readDownloadPreview(tx,ownerId,proof.request,accountKey);authorizeDownloadPreview(input.previewToken,ownerId,key,current);
  const existing=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ManualDownloadRun" WHERE "ownerId"=${ownerId}::uuid AND "requestHash"=${requestHash} AND "state" IN ('QUEUED','RUNNING','PAUSED_AUTH','PAUSED_QUOTA','CANCEL_REQUESTED','PARTIAL')`;
  const runId=existing[0]?.id??randomUUID();
  if(!existing.length){
   const evidence=canonical({accountKey,request:proof.request,previewBinding:proof.binding,previewId:current.previewId,universeSnapshotId:current.universeSnapshotId,instrumentSnapshotId:current.instrumentSnapshotId,sourceSnapshotId:current.sourceSnapshotId,dataRevision:current.dataRevision,items:current.items,acceptedAt:new Date().toISOString()});
   await tx.$executeRaw`INSERT INTO "ManualDownloadRun" ("id","ownerId","requestHash","state","evidence") VALUES (${runId}::uuid,${ownerId}::uuid,${requestHash},'QUEUED',${evidence}::jsonb)`;
   await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${runId}::uuid,'QUEUED','{"reason":"USER_SUBMISSION_ACCEPTED"}'::jsonb)`;
  }
  await tx.$executeRaw`INSERT INTO "ManualDownloadSubmission" ("ownerId","key","requestHash","runId") VALUES (${ownerId}::uuid,${input.idempotencyKey},${requestHash},${runId}::uuid)`;
  return {runId,reused:!!existing.length};
 },{isolationLevel:'Serializable',timeout:60000})}catch(error){const retry=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2002'||error.code==='P2010'&&['40001','40P01'].includes(String(error.meta?.['code'])));if(!retry||attempt===3)throw error}
 throw new Error('DOWNLOAD_SUBMISSION_RETRY_EXHAUSTED');
}
export async function readManualDownload(db:PrismaClient,ownerId:string,runId:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 const rows=await db.$queryRaw<{id:string;state:string;createdAt:Date;evidence:{request:unknown;previewBinding:string;universeSnapshotId:string;instrumentSnapshotId:string;sourceSnapshotId:string;dataRevision:string;items:unknown[]}}[]>`SELECT "id","state","createdAt","evidence" FROM "ManualDownloadRun" WHERE "id"=${runId}::uuid AND "ownerId"=${ownerId}::uuid`;
 const row=rows[0];if(!row)throw new Error('DOWNLOAD_RUN_NOT_FOUND');
 const events=await db.$queryRaw<{id:string;state:string;evidence:unknown;createdAt:Date}[]>`SELECT "id","state","evidence","createdAt" FROM "ManualDownloadEvent" WHERE "runId"=${runId}::uuid ORDER BY "createdAt","id"`;
 return {runId:row.id,status:row.state,createdAt:row.createdAt.toISOString(),request:row.evidence.request,previewBinding:row.evidence.previewBinding,universeSnapshotId:row.evidence.universeSnapshotId,instrumentSnapshotId:row.evidence.instrumentSnapshotId,sourceSnapshotId:row.evidence.sourceSnapshotId,dataRevision:row.evidence.dataRevision,items:row.evidence.items,events:events.map(e=>({...e,createdAt:e.createdAt.toISOString()})),dispatchAvailable:false,executable:false};
}
