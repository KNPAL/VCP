import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {reconcileStatement,type BrokerStatement,type PortfolioEvent} from '@vcp/portfolio';
import {canonical} from './indicators.js';
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export async function recordReconciliation(db:PrismaClient,ownerId:string,key:string,statement:BrokerStatement){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw new Error('INVALID_IDEMPOTENCY_KEY');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const identity='reconciliation:'+key,requestHash=hash(statement),prior=await tx.idempotencyRecord.findUnique({where:{ownerId_key:{ownerId,key:identity}}});
  if(prior){if(prior.requestHash!==requestHash)throw new Error('STALE_CONFLICT');return prior.response}
  const rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const events=rows.map(r=>r.evidence),decidedAt=new Date().toISOString(),result=reconcileStatement(events,statement,decidedAt),journalHash=hash(events);
  const previous=await tx.$queryRaw<{asOf:Date}[]>`SELECT "asOf" FROM "PortfolioReconciliation" WHERE "ownerId"=${ownerId}::uuid ORDER BY "decidedAt" DESC,"id" DESC LIMIT 1`;
  if(previous[0]&&new Date(statement.asOf)<previous[0].asOf)throw new Error('STALE_CONFLICT');
  const id=hash([ownerId,key,requestHash,journalHash]),evidence={id,ownerId,journalHash,statement,result};
  await tx.$executeRaw`INSERT INTO "PortfolioReconciliation" ("id","ownerId","asOf","decidedAt","journalHash","evidence") VALUES (${id},${ownerId}::uuid,${new Date(statement.asOf)},${new Date(decidedAt)},${journalHash},${canonical(evidence)}::jsonb)`;
  const response=JSON.parse(canonical(evidence)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 });
}
export async function readReconciliation(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const rows=await tx.$queryRaw<{evidence:{id:string;journalHash:string;statement:BrokerStatement;result:ReturnType<typeof reconcileStatement>}}[]>`SELECT "evidence" FROM "PortfolioReconciliation" WHERE "ownerId"=${ownerId}::uuid ORDER BY "decidedAt" DESC,"id" DESC LIMIT 20`;
  const latest=rows[0]?.evidence,changed=!!latest&&latest.journalHash!==hash(journal.map(r=>r.evidence));
  return {state:!latest||changed?'PORTFOLIO_UNRECONCILED':latest.result.state,reasons:!latest?['RECONCILIATION_REQUIRED']:changed?['JOURNAL_CHANGED_SINCE_RECONCILIATION']:latest.result.reasons,latest:latest??null,history:rows.map(r=>r.evidence),executable:false};
 },{isolationLevel:'RepeatableRead'});
}
