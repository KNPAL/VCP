import {recordJournalPositionStatus} from './position-status.js';
import {recordExitDecisions} from './exit-decisions.js';
import {resolvePartialsFromJournal} from './partial-resolution.js';
import {Prisma,PrismaClient} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {projectPortfolio,positionEpisodes} from '@vcp/portfolio';
import type {PortfolioEvent,FundingKind} from '@vcp/portfolio';
import {canonical} from './indicators.js';
import {initializePositionStops} from './protective-stops.js';
import {cashAllocations} from './cash-allocation.js';
export type JournalCommand={kind:FundingKind;amount:string;verified:boolean;occurredAt:string;sourceId:string}|
 {kind:'FILL';isin:string;side:'BUY'|'SELL';quantity:number;price:string;fees:string;brokerReference:string;occurredAt:string;sourceId:string}|
 {kind:'CORRECTION';targetId:string;reason:string;replacement:{isin:string;side:'BUY'|'SELL';quantity:number;price:string;fees:string;brokerReference:string;occurredAt:string;sourceId:string}};
export async function readPortfolio(db:PrismaClient,ownerId:string,asOf=new Date().toISOString()){
 const rows=await db.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
 return {...projectPortfolio(rows.map(x=>x.evidence),asOf),events:rows.map(x=>x.evidence).filter(x=>x.recordedAt<=asOf)};
}
export async function appendPortfolio(db:PrismaClient,ownerId:string,idempotencyKey:string,command:JournalCommand){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))throw new Error('INVALID_IDEMPOTENCY_KEY');
 const key='portfolio:'+idempotencyKey,requestHash=createHash('sha256').update(canonical(command)).digest('hex');
 for(let attempt=0;attempt<4;attempt++)try{return await db.$transaction(async tx=>{
  // Touch the lock row so concurrent serializable snapshots retry after a writer commits.
  await tx.$executeRaw`UPDATE "Owner" SET "login"="login" WHERE "id"=${ownerId}::uuid`;
  const prior=await tx.idempotencyRecord.findUnique({where:{ownerId_key:{ownerId,key}}});
  if(prior){if(prior.requestHash!==requestHash)throw new Error('STALE_CONFLICT: idempotency key payload changed');return prior.response}
  const rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const events=rows.map(row=>row.evidence),now=new Date().toISOString();let sequence=(events.at(-1)?.sequence??0)+1;
  const added:PortfolioEvent[]=[];
  if(command.kind==='CORRECTION'){
   added.push({id:randomUUID(),sequence:sequence++,kind:'REVERSAL',targetId:command.targetId,reason:command.reason,occurredAt:now,recordedAt:now,sourceId:'correction:'+idempotencyKey,author:ownerId});
   added.push({...command.replacement,id:randomUUID(),sequence,kind:'FILL',replacementOf:command.targetId,recordedAt:now,author:ownerId});
  }else added.push({...command,id:randomUUID(),sequence,recordedAt:now,author:ownerId});
  const projection=projectPortfolio([...events,...added],now);
  positionEpisodes([...events,...added],now,await cashAllocations(tx,ownerId));
  for(const event of added){const json=canonical(event);await tx.$executeRaw`INSERT INTO "PortfolioJournal" ("id","ownerId","sequence","kind","occurredAt","recordedAt","evidence") VALUES (${event.id}::uuid,${ownerId}::uuid,${event.sequence},${event.kind},${new Date(event.occurredAt)},${new Date(event.recordedAt)},${json}::jsonb)`}
  await initializePositionStops(tx,ownerId,[...events,...added],now,added.flatMap(event=>event.kind==='FILL'?[event.isin]:[]));
  await resolvePartialsFromJournal(tx,ownerId,[...events,...added],now);
  await recordExitDecisions(tx,ownerId,[...events,...added],now,added.flatMap(event=>event.kind==='FILL'?[event.isin]:[]));
  await recordJournalPositionStatus(tx,ownerId,[...events,...added],now,added.flatMap(event=>event.kind==='FILL'?[event.isin]:[]));
  const response=JSON.parse(canonical({eventIds:added.map(event=>event.id),portfolio:projection})) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key,requestHash,response}});return response;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable})}catch(error){
  const retryable=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||(error.code==='P2010'&&['40001','40P01'].includes(String(error.meta?.['code']))));
  if(retryable&&attempt<3)continue;throw error;
 }
 throw new Error('PORTFOLIO_TRANSACTION_RETRY_EXHAUSTED');
}



