import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {projectPortfolio,openEpisode,type PortfolioEvent} from '@vcp/portfolio';
import {canonical} from './indicators.js';
export async function resolvePartial(tx:Prisma.TransactionClient,signalId:string,state:string,reference:string,at:string){
 const prior=await tx.$queryRaw<{evidence:{id:string;signalId:string;state:string;reference:string;at:string;executable:boolean}}[]>`SELECT "evidence" FROM "PartialProfitResolution" WHERE "signalId"=${signalId} ORDER BY "recordedAt","id" LIMIT 1`;
 if(prior[0])return prior[0].evidence;
 const id=createHash('sha256').update(canonical([signalId,state,reference])).digest('hex'),evidence={id,signalId,state,reference,at,executable:false};
 await tx.$executeRaw`INSERT INTO "PartialProfitResolution" ("id","signalId","recordedAt","evidence") VALUES (${id},${signalId},${new Date(at)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
 const saved=await tx.$queryRaw<{evidence:typeof evidence}[]>`SELECT "evidence" FROM "PartialProfitResolution" WHERE "id"=${id}`;
 return saved[0]!.evidence;
}
export async function cancelPartialsForStop(tx:Prisma.TransactionClient,stopId:string,fullSignalId:string,at:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT s."id" FROM "PartialProfitSignal" s WHERE s."stopId"=${stopId} AND NOT EXISTS (SELECT 1 FROM "PartialProfitResolution" r WHERE r."signalId"=s."id")`;
 for(const row of rows)await resolvePartial(tx,row.id,'CANCELLED_FULL_SELL',fullSignalId,at);
}
/** Actual journal facts only; no alert may create a fill. */
export async function resolvePartialsFromJournal(tx:Prisma.TransactionClient,ownerId:string,events:PortfolioEvent[],asOf:string){
 const projection=projectPortfolio(events,asOf);
 const rows=await tx.$queryRaw<{id:string;evidence:{isin:string;recognizedAt:string;quantity:number;episodeId:string}}[]>`SELECT s."id",s."evidence" FROM "PartialProfitSignal" s WHERE s."ownerId"=${ownerId}::uuid AND NOT EXISTS (SELECT 1 FROM "PartialProfitResolution" r WHERE r."signalId"=s."id")`;
 for(const row of rows){
  const sold=events.filter(e=>e.kind==='FILL'&&e.isin===row.evidence.isin&&e.side==='SELL'&&!projection.reversed.includes(e.id)&&e.occurredAt>=row.evidence.recognizedAt&&e.recordedAt<=asOf);
  const quantity=sold.reduce((n,e)=>n+(e.kind==='FILL'?e.quantity:0),0);
  if(openEpisode(events,row.evidence.isin,asOf)?.identity!==row.evidence.episodeId)await resolvePartial(tx,row.id,'CLOSED_WITHOUT_SIGNAL_EXECUTION',events.at(-1)!.id,asOf);
  else if(quantity>=row.evidence.quantity)await resolvePartial(tx,row.id,'ACTUAL_SELL_RECORDED',sold.at(-1)!.id,asOf);
 }
}
