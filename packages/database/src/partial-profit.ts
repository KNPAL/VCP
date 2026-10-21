import {createHash} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {openEpisode,partialProfit,type PortfolioEvent,type ProtectiveQuote} from '@vcp/portfolio';
import {canonicalListings,type InstrumentSnapshot} from '@vcp/market-data';
import {ST_VCP_4_0,PROFILE_VERSION} from '@vcp/strategy';
import {actionScale,type InitialStop} from './protective-stops.js';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
import {resolvePartial} from './partial-resolution.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export async function evaluatePartialProfit(db:PrismaClient,ownerId:string,isin:string,quote:ProtectiveQuote|null){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  let asOf=new Date().toISOString();const episode=openEpisode(journal.map(r=>r.evidence),isin,asOf);
  if(!episode)return {state:'CLOSED',executable:false};
  const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "episodeId"=${episode.identity}::uuid AND "isin"=${isin}`;
  const record=stops[0]?.evidence;if(!record?.stop||record.fillId!==episode.first.id)return {state:'UNABLE_TO_EVALUATE',executable:false};
  const prior=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PartialProfitSignal" WHERE "stopId"=${record.id}`;
  if(prior[0])return {state:'ALREADY_EMITTED',evidence:prior[0].evidence,executable:false};
  const full=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ProtectiveSignal" WHERE "stopId"=${record.id} UNION ALL SELECT "id" FROM "PositionFailure" WHERE "stopId"=${record.id} AND "state"='SELL_BREAKOUT_FAILURE' UNION ALL SELECT "id" FROM "PositionTrail" WHERE "stopId"=${record.id} AND "state"='SELL_EMA_CLOSE' LIMIT 1`;
  if(full.length)return {state:'FULL_SELL_PENDING',executable:false};
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const listing=canonicalListings(mappings.map(r=>r.evidence),[isin],asOf)[0]?.primary;
  if(!listing||listing.listingId!==record.stop.listingId)return {state:'UNABLE_TO_EVALUATE',executable:false};
  const scale=await actionScale(tx,listing.listingId,asOf);asOf=new Date().toISOString();
  const result=partialProfit(episode.first.price,record.stop,quote,scale,episode.quantity,listing.lot,asOf);
  if(!ST_VCP_4_0.partialProfitEnabled||result.state!=='PARTIAL_PROFIT')return result;
  const id=hash([record.id,'PARTIAL_PROFIT']),evidence={id,ownerId,isin,stopId:record.id,episodeId:episode.identity,recognizedAt:asOf,quantity:result.suggestedQuantity,firstEntry:episode.first.price,initialStop:record.stop,quote,result,executable:false as const};
  await tx.$executeRaw`INSERT INTO "PartialProfitSignal" ("id","ownerId","stopId","recognizedAt","evidence") VALUES (${id},${ownerId}::uuid,${record.id},${new Date(asOf)},${canonical(evidence)}::jsonb)`;
  await appendAlert(tx,{...evidence,sourceEventId:id,kind:'PARTIAL_PROFIT',sourceAt:quote!.sourceAt,occurredAt:quote!.sourceAt,decidedAt:asOf,effectiveAt:asOf,strategyVersion:PROFILE_VERSION,configHash:record.configHash,dataRevision:hash([record.id,quote])},[ownerId]);
  return {state:'PARTIAL_PROFIT',evidence,created:true,executable:false};
 });
}
export async function dismissPartialProfit(db:PrismaClient,ownerId:string,key:string,signalId:string,reason:string){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key)||!/^[a-f0-9]{64}$/.test(signalId)||!reason.trim()||reason.length>1000)throw new Error('INVALID_PARTIAL_DISMISSAL');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const identity='partial-dismiss:'+key,requestHash=hash([signalId,reason]),prior=await tx.idempotencyRecord.findUnique({where:{ownerId_key:{ownerId,key:identity}}});
  if(prior){if(prior.requestHash!==requestHash)throw new Error('STALE_CONFLICT');return prior.response}
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "PartialProfitSignal" WHERE "id"=${signalId} AND "ownerId"=${ownerId}::uuid`;
  if(!rows.length)throw new Error('PARTIAL_SIGNAL_NOT_FOUND');
  const result=await resolvePartial(tx,signalId,'DISMISSED',reason,new Date().toISOString()),response=JSON.parse(canonical(result)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 });
}
