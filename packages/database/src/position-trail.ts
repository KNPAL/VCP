import {cancelPartialsForStop} from './partial-resolution.js';
import {hasHigherExit,recordExitDecisions} from './exit-decisions.js';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {openEpisode,trailingStop,type PortfolioEvent} from '@vcp/portfolio';
import {ema21,atr14} from '@vcp/indicators';
import {verifiedCalendar,canonicalListings,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
import {exchangeDate,utcInstant,parseFixed} from '@vcp/domain';
import {PROFILE_VERSION} from '@vcp/strategy';
import {initializePositionStops,actionScale,type InitialStop} from './protective-stops.js';
import {loadSeries} from './eod-scan.js';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
import {recordBreakoutFailure} from './position-failure.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export async function evaluatePositionTrail(db:PrismaClient,ownerId:string,isin:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const asOf=new Date().toISOString();
  const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const events=journal.map(r=>r.evidence),episode=openEpisode(events,isin,asOf);if(!episode)return {state:'CLOSED',executable:false};
  await initializePositionStops(tx,ownerId,events,asOf,[isin]);
  const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "episodeId"=${episode.identity}::uuid AND "isin"=${isin}`;
  const record=stops[0]!.evidence;
  if(!record.stop||record.fillId!==episode.first.id)return {state:'UNKNOWN',reason:'INITIAL_STOP_UNAVAILABLE',executable:false};
  const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=${new Date(asOf)} ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${new Date(asOf)} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const listing=canonicalListings(mappings.map(r=>r.evidence),[isin],asOf)[0]?.primary;
  if(!listing||listing.listingId!==record.stop.listingId)return {state:'UNKNOWN',reason:'LISTING_UNAVAILABLE',executable:false};
  const calendar=calendars[0];if(!calendar)return {state:'UNKNOWN',reason:'CALENDAR_UNAVAILABLE',executable:false};
  const finalized=verifiedCalendar(calendar.evidence,exchangeDate(episode.first.occurredAt),exchangeDate(asOf),asOf);
  const day=finalized.sessions.at(-1);
  if(finalized.state!=='KNOWN'||!day||utcInstant(day.closesAt!)<utcInstant(episode.first.occurredAt))return {state:'UNKNOWN',reason:'FINALIZED_SESSION_UNAVAILABLE',executable:false};
  const previous=await tx.$queryRaw<{session:Date;evidence:{result:ReturnType<typeof trailingStop>}}[]>`SELECT "session","evidence" FROM "PositionTrail" WHERE "stopId"=${record.id} AND "state"<>'UNKNOWN' ORDER BY "session" DESC,"decidedAt" DESC,"id" LIMIT 1`;
  const adjustments=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "AdjustmentSnapshot" WHERE "listingId"=${listing.listingId}::uuid AND "asOf"<=${new Date(asOf)} AND "createdAt"<=${new Date(asOf)} ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`;
  const revision=adjustments[0]?.id;
  if(!revision)return {state:'UNKNOWN',reason:'ADJUSTMENT_UNAVAILABLE',executable:false};
  let loaded:Awaited<ReturnType<typeof loadSeries>>;
  try{loaded=await loadSeries(tx,revision,{scanId:episode.identity,session:day.date,asOf,calendarId:calendar.id})}catch{return {state:'UNKNOWN',reason:'FINAL_SERIES_UNAVAILABLE',executable:false}}
  const scaleVerified=loaded.scaleRevision===record.stop.scaleRevision&&await actionScale(tx,listing.listingId,asOf)===record.stop.scaleRevision;
  await recordBreakoutFailure(tx,ownerId,record,episode,loaded.series,calendar.evidence,scaleVerified,asOf);
  if(previous[0]&&previous[0].session.toISOString().slice(0,10)>=day.date)return {state:'ALREADY_EVALUATED',evidence:previous[0].evidence,executable:false};
  const future=calendar.evidence.filter(d=>d.date>day.date&&d.kind!=='HOLIDAY').sort((a,b)=>a.date.localeCompare(b.date))[0];
  const next=future&&verifiedCalendar(calendar.evidence,day.date,future.date,asOf).state==='KNOWN'?{date:future.date,opensAt:future.opensAt!}:null;
  const prior=previous[0]?.evidence.result;
  const activationPrice=2n*parseFixed(episode.first.price)-parseFixed(record.stop.activeStop);
  const activated=(prior?.activated??false)||loaded.series.bars.some(bar=>{
   const session=calendar.evidence.find(d=>d.date===bar.session);
   return !!session?.closesAt&&utcInstant(session.closesAt)>=utcInstant(episode.first.occurredAt)&&parseFixed(bar.close)>=activationPrice;
  });
  const input={entry:episode.first.price,initialStop:record.stop.activeStop,activeStop:prior?.nextStop??record.stop.activeStop,tick:listing.tick,
   close:loaded.series.bars.at(-1)!.close,ema21:ema21(loaded.series).value,atr14:atr14(loaded.series).value,
   activated,scaleVerified,
   session:day.date,closedAt:day.closesAt!,finalizedAt:day.finalizedAt!,asOf,nextSession:next,sourceRevision:revision};
  const result=trailingStop(input),id=hash([record.id,day.date,revision,calendar.id,result.state,result.reasons]);
  const evidence={id,ownerId,isin,stopId:record.id,episodeId:episode.identity,fillId:episode.first.id,calendarId:calendar.id,input,result,executable:false as const};
  const inserted=await tx.$executeRaw`INSERT INTO "PositionTrail" ("id","ownerId","stopId","session","decidedAt","effectiveAt","state","evidence") VALUES (${id},${ownerId}::uuid,${record.id},${new Date(day.date)},${new Date(asOf)},${result.effectiveAt?new Date(result.effectiveAt):null},${result.state},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
  if(result.state==='SELL_EMA_CLOSE')await cancelPartialsForStop(tx,record.id,id,asOf);
  if(inserted&&result.state==='SELL_EMA_CLOSE'&&!await hasHigherExit(tx,record.id,'SELL_EMA_CLOSE'))await appendAlert(tx,{...evidence,sourceEventId:id,kind:'SELL',sourceAt:day.finalizedAt!,occurredAt:day.finalizedAt!,decidedAt:asOf,effectiveAt:result.effectiveAt!,strategyVersion:PROFILE_VERSION,configHash:record.configHash,dataRevision:revision},[ownerId]);
  await recordExitDecisions(tx,ownerId,events,asOf,[isin]);
  const saved=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionTrail" WHERE "id"=${id}`;
  return {state:result.state,evidence:saved[0]!.evidence,created:!!inserted,executable:false};
 },{timeout:30000});
}


