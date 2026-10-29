import {recordExitDecisions} from './exit-decisions.js';
import {cancelPartialsForStop} from './partial-resolution.js';
import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {openEpisode,projectPortfolio,protectiveDecision,type PortfolioEvent,type ProtectiveStop,type ProtectiveQuote} from '@vcp/portfolio';
import {canonicalListings,type InstrumentSnapshot,type ActionSnapshot} from '@vcp/market-data';
import {structuralStop,PROFILE_VERSION,configurationHash,ST_VCP_4_0} from '@vcp/strategy';
import {exchangeDate,parseFixed,utcInstant} from '@vcp/domain';
import type {DailyStructureResult} from './daily-structure.js';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
import {effectivePositionStop} from './trail-state.js';
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface InitialStop {id:string;isin:string;episodeId:string;fillId:string;quantityAtCreation:number;state:'KNOWN'|'UNKNOWN';reason:string|null;stop:ProtectiveStop|null;sourceId:string|null;configHash:string;recordedAt:string}
/** Must be called under the same owner lock and transaction as actual journal writes. */
export async function initializePositionStops(tx:Prisma.TransactionClient,ownerId:string,events:readonly PortfolioEvent[],asOf:string,isins?:readonly string[]){
 const portfolio=projectPortfolio(events,asOf);
 for(const isin of Object.keys(portfolio.holdings)){
  if(isins&&!isins.includes(isin))continue;
  const episode=openEpisode(events,isin,asOf)!;
  const existing=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "isin"=${isin} AND "episodeId"=${episode.identity}::uuid`;
  if(existing[0])continue;
  const cutoff=utcInstant(episode.first.occurredAt),mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${cutoff} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const listing=canonicalListings(mappings.map(r=>r.evidence),[isin],episode.first.occurredAt)[0]?.primary;
  const sources=listing?await tx.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${listing.listingId}::uuid AND ("evidence"->'input'->>'decidedAt')::timestamptz<=${cutoff} AND "createdAt"<=${utcInstant(asOf)} ORDER BY "session" DESC LIMIT 1`:[];
  const source=sources[0]?.evidence,primary=source?.detector.frozen.primary;
  let stop:ProtectiveStop|null=null,reason='CONFIRMED_STRUCTURE_UNAVAILABLE';
  if(listing&&source&&primary&&['READY','WATCH'].includes(primary.state)&&utcInstant(primary.asOf)<=cutoff&&source.input.scaleRevision){
   const initial=structuralStop(primary.lastLow,listing.tick,episode.first.price);
   if(parseFixed(initial.stop)>0n)stop={listingId:listing.listingId,activeStop:initial.stop,scaleRevision:source.input.scaleRevision,effectiveAt:asOf};
   else reason='INVALID_STRUCTURAL_STOP';
  }
  const id=hash([ownerId,isin,episode.identity]),evidence:InitialStop={id,isin,episodeId:episode.identity,fillId:episode.first.id,quantityAtCreation:episode.quantity,state:stop?'KNOWN':'UNKNOWN',reason:stop?null:reason,stop,sourceId:source?.id??null,configHash:source?.input.configHash??configurationHash(ST_VCP_4_0),recordedAt:asOf};
  await tx.$executeRaw`INSERT INTO "InitialPositionStop" ("id","ownerId","isin","episodeId","evidence") VALUES (${id},${ownerId}::uuid,${isin},${episode.identity}::uuid,${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
 }
}
export async function actionScale(tx:Prisma.TransactionClient,listingId:string,asOf:string){
 const rows=await tx.$queryRaw<{state:string;evidence:{source:ActionSnapshot}}[]>`SELECT "state","evidence" FROM "AdjustmentSnapshot" WHERE "listingId"=${listingId}::uuid AND "asOf"<=${utcInstant(asOf)} AND "createdAt"<=${utcInstant(asOf)} ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`;
 const row=rows[0],source=row?.evidence.source,date=exchangeDate(asOf);
 if(!row||row.state!=='KNOWN'||!source||!source.verified||!source.sourceReference||source.coverageFrom>date||source.coverageThrough<date||utcInstant(source.knownAt)>utcInstant(asOf))return null;
 const actions=source.actions.filter(a=>exchangeDate(a.effectiveAt)<=date).sort((a,b)=>a.id.localeCompare(b.id));
 if(actions.some(a=>!a.verified||!a.sourceReference||utcInstant(a.knownAt)>utcInstant(asOf)||utcInstant(a.effectiveAt)>utcInstant(asOf)))return null;
 return hash(actions);
}
export async function evaluatePositionStop(db:PrismaClient,ownerId:string,isin:string,quote:ProtectiveQuote|null){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  let asOf=new Date().toISOString();
  const rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`,events=rows.map(r=>r.evidence);
  const episode=openEpisode(events,isin,asOf);if(!episode)return {state:'CLOSED',executable:false};
  await initializePositionStops(tx,ownerId,events,asOf,[isin]);
  const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "isin"=${isin} AND "episodeId"=${episode.identity}::uuid`;
  const record=stops[0]!.evidence,stop=record.fillId===episode.first.id?await effectivePositionStop(tx,record,asOf):null;
  const scale=stop?await actionScale(tx,stop.listingId,asOf):null;asOf=new Date().toISOString();const result=protectiveDecision(stop,quote,scale,episode.quantity,asOf);
  if(result.state!=='SELL_PROTECTIVE')return {...result,stopId:record.id};
  const session=exchangeDate(asOf),id=hash([record.id,session]),evidence={...result,id,ownerId,isin,stopId:record.id,episodeId:episode.identity,activeStop:stop!.activeStop,scaleRevision:scale,session,kind:'SELL_PROTECTIVE',configHash:record.configHash,quote};
  const inserted=await tx.$executeRaw`INSERT INTO "ProtectiveSignal" ("id","ownerId","stopId","session","recognizedAt","evidence") VALUES (${id},${ownerId}::uuid,${record.id},${new Date(session)},${utcInstant(asOf)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
  await cancelPartialsForStop(tx,record.id,id,asOf);
  if(inserted)await appendAlert(tx,{...evidence,id,sourceEventId:id,kind:'SELL',sourceAt:quote!.sourceAt,occurredAt:quote!.sourceAt,decidedAt:asOf,effectiveAt:asOf,strategyVersion:PROFILE_VERSION,dataRevision:hash([record.id,quote,scale]),executable:false},[ownerId]);
  await recordExitDecisions(tx,ownerId,events,asOf,[isin]);
  const saved=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ProtectiveSignal" WHERE "id"=${id}`;return {state:'SELL_PROTECTIVE',signal:saved[0]!.evidence,created:!!inserted,executable:false};
 });
}
export async function readPositionStops(db:PrismaClient,ownerId:string){
 const exitDecisions=await db.$queryRaw<{evidence:unknown}[]>`SELECT DISTINCT ON ("stopId") "evidence" FROM "ExitDecision" WHERE "ownerId"=${ownerId}::uuid ORDER BY "stopId","recordedAt" DESC,"id"`;
 const exitResolutions=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ExitResolution" WHERE "ownerId"=${ownerId}::uuid ORDER BY "recordedAt" DESC,"id" LIMIT 100`;
 const partials=await db.$queryRaw<{evidence:unknown;resolutions:unknown[]}[]>`SELECT s."evidence",COALESCE((SELECT jsonb_agg(r."evidence" ORDER BY r."recordedAt",r."id") FROM "PartialProfitResolution" r WHERE r."signalId"=s."id"),'[]'::jsonb) AS resolutions FROM "PartialProfitSignal" s WHERE s."ownerId"=${ownerId}::uuid ORDER BY s."recognizedAt" DESC,s."id" LIMIT 100`;
 const failures=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionFailure" WHERE "ownerId"=${ownerId}::uuid ORDER BY "recognizedAt" DESC,"id" LIMIT 100`;
 const trails=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionTrail" WHERE "ownerId"=${ownerId}::uuid ORDER BY "session" DESC,"decidedAt" DESC,"id" LIMIT 100`;
 const stops=await db.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid ORDER BY "isin","id"`;
 const signals=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "ProtectiveSignal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "recognizedAt" DESC,"id" LIMIT 100`;
 const journal=await db.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`,events=journal.map(r=>r.evidence),asOf=new Date().toISOString(),p=projectPortfolio(events,asOf);
 const items=await Promise.all(Object.keys(p.holdings).map(async isin=>{const episode=openEpisode(events,isin,asOf)!,record=stops.find(r=>r.evidence.isin===isin&&r.evidence.episodeId===episode.identity)?.evidence;
  let state=record?.fillId===episode.first.id?record.state:'UNKNOWN',reason=record?.fillId===episode.first.id?record.reason:'INITIAL_STOP_EVIDENCE_UNAVAILABLE';
  if(state==='KNOWN'&&record?.stop&&await actionScale(db,record.stop.listingId,asOf)!==record.stop.scaleRevision){state='UNKNOWN';reason='PRICE_SCALE_UNVERIFIED'}
  const activeStop=record&&record.fillId===episode.first.id?await effectivePositionStop(db,record,asOf):null;
  return {isin,quantity:episode.quantity,record:record?{...record,initialStop:record.stop,stop:activeStop}:null,state,reason};
 }));
 return {items,partials,exitDecisions:exitDecisions.map(r=>r.evidence),exitResolutions:exitResolutions.map(r=>r.evidence),stops:stops.map(r=>r.evidence),signals:signals.map(r=>r.evidence),trails:trails.map(r=>r.evidence),failures:failures.map(r=>r.evidence),asOf,executable:false};
}




