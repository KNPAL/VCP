import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {positionEpisodes,type CashAllocation,type PortfolioEvent} from '@vcp/portfolio';
import {canonical} from './indicators.js';
export async function cashAllocations(tx:Prisma.TransactionClient,ownerId:string){
 const rows=await tx.$queryRaw<{evidence:CashAllocation}[]>`SELECT DISTINCT ON ("cashEventId") "evidence" FROM "PortfolioCashAllocation" WHERE "ownerId"=${ownerId}::uuid ORDER BY "cashEventId","sequence" DESC`;
 return rows.map(r=>r.evidence);
}
export async function recordCashAllocation(db:PrismaClient,ownerId:string,key:string,input:{cashEventId:string;episodeId:string;reason:string}){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key)||![input.cashEventId,input.episodeId].every(s=>/^[0-9a-f-]{36}$/.test(s))||!input.reason.trim()||input.reason.length>1000)throw new Error('INVALID_CASH_ALLOCATION');
 const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const identity='cash-allocation:'+key,requestHash=hash(input),prior=await tx.idempotencyRecord.findUnique({where:{ownerId_key:{ownerId,key:identity}}});
  if(prior){if(prior.requestHash!==requestHash)throw new Error('STALE_CONFLICT');return prior.response}
  const rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const existing=await cashAllocations(tx,ownerId),recordedAt=new Date().toISOString(),id=hash([ownerId,key,requestHash]),evidence={...input,id,recordedAt};
  positionEpisodes(rows.map(r=>r.evidence),recordedAt,[...existing.filter(a=>a.cashEventId!==input.cashEventId),evidence]);
  await tx.$executeRaw`INSERT INTO "PortfolioCashAllocation" ("id","ownerId","cashEventId","episodeId","evidence") VALUES (${id},${ownerId}::uuid,${input.cashEventId}::uuid,${input.episodeId}::uuid,${canonical(evidence)}::jsonb)`;
  const response=JSON.parse(canonical(evidence)) as Prisma.InputJsonValue;await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 });
}
