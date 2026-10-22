import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {exitPrecedence,openEpisode,type ExitCandidate,type PortfolioEvent} from '@vcp/portfolio';
import {canonical} from './indicators.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export async function hasHigherExit(tx:Prisma.TransactionClient,stopId:string,kind:ExitCandidate['kind']){
 const signals=await readExitCandidates(tx,stopId),active=exitPrecedence(signals,1,new Date().toISOString()).primary;
 const order=['SELL_PROTECTIVE','SELL_BREAKOUT_FAILURE','SELL_EMA_CLOSE','PARTIAL_PROFIT'];
 return !!active&&order.indexOf(active.kind)<order.indexOf(kind);
}
export async function readExitCandidates(tx:Prisma.TransactionClient,stopId:string):Promise<ExitCandidate[]>{
 const rows=await tx.$queryRaw<{id:string;kind:ExitCandidate['kind'];recognizedAt:Date;effectiveAt:Date;sourceRevision:string;resolved:boolean}[]>`
 SELECT s.*,EXISTS(SELECT 1 FROM "ExitResolution" r WHERE r."signalId"=s.id) AS resolved FROM (
 SELECT "id",'SELL_PROTECTIVE' AS kind,"recognizedAt","recognizedAt" AS "effectiveAt","evidence"->>'scaleRevision' AS "sourceRevision" FROM "ProtectiveSignal" WHERE "stopId"=${stopId}
 UNION ALL SELECT "id",'SELL_BREAKOUT_FAILURE',"recognizedAt","effectiveAt","evidence"->>'dataRevision' FROM "PositionFailure" WHERE "stopId"=${stopId} AND "state"='SELL_BREAKOUT_FAILURE'
 UNION ALL SELECT "id",'SELL_EMA_CLOSE',"decidedAt","effectiveAt","evidence"->'input'->>'sourceRevision' FROM "PositionTrail" WHERE "stopId"=${stopId} AND "state"='SELL_EMA_CLOSE'
 ) s ORDER BY s.id`;
 const partials=await tx.$queryRaw<{id:string;recognizedAt:Date;sourceRevision:string;resolved:boolean}[]>`SELECT s."id",s."recognizedAt",s."evidence"->'initialStop'->>'scaleRevision' AS "sourceRevision",EXISTS(SELECT 1 FROM "PartialProfitResolution" r WHERE r."signalId"=s."id") AS resolved FROM "PartialProfitSignal" s WHERE s."stopId"=${stopId}`;
 return [...rows.map(r=>({...r,recognizedAt:r.recognizedAt.toISOString(),effectiveAt:r.effectiveAt.toISOString()})),...partials.map(r=>({...r,kind:'PARTIAL_PROFIT' as const,recognizedAt:r.recognizedAt.toISOString(),effectiveAt:r.recognizedAt.toISOString()}))];
}
/** Caller holds the portfolio owner lock. Every source remains immutable. */
export async function recordExitDecisions(tx:Prisma.TransactionClient,ownerId:string,events:PortfolioEvent[],asOf:string,isins?:string[]){
 const stops=await tx.$queryRaw<{id:string;isin:string;episodeId:string}[]>`SELECT "id","isin","episodeId" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid ORDER BY "id"`;
 for(const stop of stops){
  if(isins&&!isins.includes(stop.isin))continue;
  const episode=openEpisode(events,stop.isin,asOf),quantity=episode?.identity===stop.episodeId?episode.quantity:0;
  let signals=await readExitCandidates(tx,stop.id);
  if(quantity===0){
   for(const signal of signals.filter(s=>!s.resolved&&s.kind!=='PARTIAL_PROFIT')){
    const id=hash([signal.id,'CLOSED_WITHOUT_SIGNAL_EXECUTION']),evidence={id,signalId:signal.id,stopId:stop.id,ownerId,isin:stop.isin,episodeId:stop.episodeId,state:'CLOSED_WITHOUT_SIGNAL_EXECUTION',recognizedAt:asOf,journalRevision:hash(events),executable:false};
    await tx.$executeRaw`INSERT INTO "ExitResolution" ("id","ownerId","signalId","recordedAt","evidence") VALUES (${id},${ownerId}::uuid,${signal.id},${new Date(asOf)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
   }
   signals=await readExitCandidates(tx,stop.id);
  }
  const journalRevision=hash(events),result=exitPrecedence(signals,quantity,asOf),id=hash([stop.id,quantity,journalRevision,signals,result.state,result.effective]);
  const evidence={id,ownerId,isin:stop.isin,stopId:stop.id,episodeId:stop.episodeId,quantity,asOf,journalRevision,candidates:signals,result,executable:false};
  await tx.$executeRaw`INSERT INTO "ExitDecision" ("id","ownerId","stopId","recordedAt","evidence") VALUES (${id},${ownerId}::uuid,${stop.id},${new Date(asOf)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
 }
}
export async function evaluateExitDecisions(db:PrismaClient,ownerId:string,isin:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  await recordExitDecisions(tx,ownerId,rows.map(r=>r.evidence),new Date().toISOString(),[isin]);
 },{timeout:30000});
}

