import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {shadowReview,SHADOW_CONTRACT_VERSION,type ShadowReviewInput} from '@vcp/strategy';
import {canonical} from './indicators.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
/** Offline audit sink only. No model calls and no dependency from any decision/monitor path. */
export async function recordShadowAudit(db:PrismaClient,ownerId:string,key:string,input:ShadowReviewInput){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw new Error('INVALID_SHADOW_AUDIT_KEY');
 const requestHash=hash(input),id=hash([ownerId,key]),recordedAt=new Date().toISOString();
 let result:ReturnType<typeof shadowReview>|null=null,rejection:string|null=null;
 try{result=shadowReview(input);if(input.at>recordedAt){result=null;rejection='FUTURE_SHADOW_CONTEXT'}}catch{rejection='INVALID_SHADOW_INPUT'}
 // Invalid input is identified by its digest, never by retaining arbitrary model text or secrets.
 const evidence={id,contractVersion:SHADOW_CONTRACT_VERSION,recordedAt,requestHash,result,rejection,outcome:result?.outcome??'UNAVAILABLE',authoritative:false,executable:false};
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{requestHash:string;evidence:unknown}[]>`SELECT "requestHash","evidence" FROM "ShadowReviewAudit" WHERE "id"=${id} AND "ownerId"=${ownerId}::uuid`;
  if(prior[0]){if(prior[0].requestHash!==requestHash)throw new Error('STALE_CONFLICT');return prior[0].evidence}
  await tx.$executeRaw`INSERT INTO "ShadowReviewAudit" ("id","ownerId","recordedAt","requestHash","evidence") VALUES (${id},${ownerId}::uuid,${new Date(recordedAt)},${requestHash},${canonical(evidence)}::jsonb)`;
  return evidence;
 });
}
export async function readShadowAudits(db:PrismaClient,ownerId:string){
 const rows=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ShadowReviewAudit" WHERE "ownerId"=${ownerId}::uuid ORDER BY "recordedAt" DESC,"id" LIMIT 100`;
 return {items:rows.map(r=>r.evidence),authoritative:false,executable:false};
}
