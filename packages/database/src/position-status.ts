import {createHash} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {openEpisode,positionEpisodes,positionStatus,protectiveDecision,partialProfit,exitPrecedence,type PortfolioEvent,type PositionStatusInput} from '@vcp/portfolio';
import {assessHeldQuote,verifiedCalendar,canonicalListings,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
import {exchangeDate} from '@vcp/domain';
import {canonical} from './indicators.js';
import {actionScale,type InitialStop} from './protective-stops.js';
import {effectivePositionStop} from './trail-state.js';
import {readExitCandidates} from './exit-decisions.js';
import type {PortfolioQuotes} from './portfolio-risk.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export async function recordPositionStatus(db:PrismaClient,ownerId:string,isin:string,quote:PortfolioQuotes[string]|null){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const events=journal.map(r=>r.evidence),at=new Date().toISOString(),episode=openEpisode(events,isin,at),episodes=positionEpisodes(events,at).episodes;
  const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "isin"=${isin} ORDER BY "evidence"->>'recordedAt' DESC,"id"`;
  const record=(episode?stops.find(r=>r.evidence.episodeId===episode.identity):stops[0])?.evidence;
  if(!record)return {state:'NO_ACTUAL_POSITION',executable:false};
  const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const trail=await tx.$queryRaw<{id:string;session:Date;state:string;evidence:{calendarId:string;input:{sourceRevision:string}}}[]>`SELECT "id","session","state","evidence" FROM "PositionTrail" WHERE "stopId"=${record.id} ORDER BY "session" DESC,"decidedAt" DESC,"id" LIMIT 1`;
  const failure=await tx.$queryRaw<{id:string;session:Date;state:string}[]>`SELECT "id","session","state" FROM "PositionFailure" WHERE "stopId"=${record.id} ORDER BY "session" DESC,"recognizedAt" DESC,"id" LIMIT 1`;
  const active=episode?.first.id===record.fillId?await effectivePositionStop(tx,record,at):null,scale=active?await actionScale(tx,active.listingId,at):null;
  const revisions=active?await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "AdjustmentSnapshot" WHERE "listingId"=${active.listingId}::uuid AND "asOf"<=${new Date(at)} AND "createdAt"<=${new Date(at)} ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`:[];
  const asOf=new Date().toISOString(),calendar=calendars[0],mapping=mappings[0]?.evidence??null,assessment=assessHeldQuote(isin,asOf,calendar?.evidence??null,mapping,quote?{state:'KNOWN',quote}:{state:'UNKNOWN',reason:'QUOTE_UNAVAILABLE'});
  const quantity=episode?.quantity??0,candidates=await readExitCandidates(tx,record.id),primary=exitPrecedence(candidates,quantity,asOf).primary;
  const protection=protectiveDecision(active,assessment.state==='FEED_FRESH'?quote:null,scale,quantity,asOf);
  const listing=canonicalListings(mapping?[mapping]:[],[isin],asOf)[0]?.primary;
  const partial=partialProfit(episode?.first.price??'1',record.stop,assessment.state==='FEED_FRESH'?quote:null,scale,quantity,listing?.lot??1,asOf);
  let trailing:PositionStatusInput['trailing']='UNKNOWN',failed:PositionStatusInput['failure']='UNKNOWN';
  if(episode&&calendar){
   const days=verifiedCalendar(calendar.evidence,exchangeDate(episode.first.occurredAt),exchangeDate(asOf),asOf),last=days.sessions.at(-1);
   const unfinalized=calendar.evidence.some(d=>d.kind!=='HOLIDAY'&&d.closesAt&&d.closesAt>=episode.first.occurredAt&&d.closesAt<=asOf&&(!d.finalizedAt||d.finalizedAt>asOf));
   if(days.state==='KNOWN'&&!unfinalized){
    if(!last||last.closesAt!<episode.first.occurredAt){trailing='NOT_APPLICABLE';failed='NOT_APPLICABLE'}
    else if(scale&&scale===record.stop?.scaleRevision){
     const sameSeries=trail[0]?.evidence.calendarId===calendar.id&&trail[0]?.evidence.input.sourceRevision===revisions[0]?.id;
     if(sameSeries&&trail[0]?.session.toISOString().slice(0,10)===last.date&&['WAITING_1R','TRAIL_UPDATE','TRAIL_UNCHANGED'].includes(trail[0].state))trailing='CLEAR';
     if(sameSeries&&failure[0]?.session.toISOString().slice(0,10)===last.date&&['OBSERVING','WINDOW_COMPLETE'].includes(failure[0].state))failed='CLEAR';
    }
   }
  }
  const partiallySold=!!episode&&events.some(e=>e.kind==='FILL'&&e.isin===isin&&e.side==='SELL'&&episodes.find(p=>p.id===episode.identity)?.fillIds.includes(e.id));
  const input:PositionStatusInput={quantity,partiallySold,primary:primary?.kind??null,health:assessment.state==='SESSION_CLOSED'?'MARKET_CLOSED':assessment.state==='FEED_FRESH'&&active&&scale===active.scaleRevision?'FEED_FRESH':'MONITOR_DEGRADED',
   protective:protection.state==='NOT_BREACHED'?'CLEAR':'UNKNOWN',trailing,failure:failed,partial:candidates.some(c=>c.kind==='PARTIAL_PROFIT'&&c.resolved)?'RESOLVED':['BELOW_2R','LOT_TOO_SMALL'].includes(partial.state)?'CLEAR':'UNKNOWN',reasons:[assessment.reason,...protection.reasons]};
  const result=positionStatus(input),sources={journal:hash(events),calendar:calendar?.id??null,mapping:mapping?.id??null,trail:trail[0]?.id??null,failure:failure[0]?.id??null,adjustment:revisions[0]?.id??null,quote:quote?hash(quote):null,quoteProvider:quote?.provider??null,activeStop:active,candidates};
  const close=calendar?.evidence.find(d=>d.date===exchangeDate(asOf))?.closesAt;
  const id=hash([record.id,result,sources,Math.floor(Date.parse(asOf)/10000)]),validUntil=new Date(Math.min(Date.parse(asOf)+15000,...(quote?[Date.parse(quote.validUntil),Date.parse(quote.sourceAt)+60000]:[]),...(close&&Date.parse(close)>Date.parse(asOf)?[Date.parse(close)]:[]))).toISOString(),evidence={id,ownerId,isin,episodeId:record.episodeId,stopId:record.id,asOf,validUntil,input,result,sources,executable:false};
  await tx.$executeRaw`INSERT INTO "PositionStatusHistory" ("id","ownerId","stopId","recordedAt","evidence") VALUES (${id},${ownerId}::uuid,${record.id},${new Date(asOf)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
  return evidence;
 },{timeout:30000});
}
/** Actual-fill lifecycle changes commit atomically with the journal. */
export async function recordJournalPositionStatus(tx:Prisma.TransactionClient,ownerId:string,events:PortfolioEvent[],asOf:string,isins:string[]){
 if(!isins.length)return;
 const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid`;
 const episodes=positionEpisodes(events,asOf).episodes;
 for(const {evidence:stop} of stops){
  if(!isins.includes(stop.isin))continue;
  const open=openEpisode(events,stop.isin,asOf),episode=open?.identity===stop.episodeId?open:null,quantity=episode?.quantity??0;
  const partiallySold=!!episode&&events.some(e=>e.kind==='FILL'&&e.isin===stop.isin&&e.side==='SELL'&&episodes.find(p=>p.id===episode.identity)?.fillIds.includes(e.id));
  const primary=exitPrecedence(await readExitCandidates(tx,stop.id),quantity,asOf).primary;
  const result=positionStatus({quantity,partiallySold,primary:primary?.kind??null,health:'MONITOR_DEGRADED',protective:'UNKNOWN',trailing:'UNKNOWN',failure:'UNKNOWN',partial:'UNKNOWN',reasons:['JOURNAL_CHANGED_REEVALUATION_REQUIRED']});
  const sources={journal:hash(events)},id=hash([stop.id,result,sources]),evidence={id,ownerId,isin:stop.isin,episodeId:stop.episodeId,stopId:stop.id,asOf,validUntil:asOf,result,sources,executable:false};
  await tx.$executeRaw`INSERT INTO "PositionStatusHistory" ("id","ownerId","stopId","recordedAt","evidence") VALUES (${id},${ownerId}::uuid,${stop.id},${new Date(asOf)},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
 }
}
export async function readPositionStatus(db:PrismaClient,ownerId:string){
 const rows=await db.$queryRaw<{evidence:{id:string;isin:string;stopId:string;asOf:string;validUntil:string;sources:{journal:string;mapping?:string;calendar?:string;adjustment?:string;activeStop?:{listingId:string}};result:ReturnType<typeof positionStatus>}}[]>`SELECT DISTINCT ON ("stopId") "evidence" FROM "PositionStatusHistory" WHERE "ownerId"=${ownerId}::uuid ORDER BY "stopId","recordedAt" DESC,"id"`;
 const journal=await db.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
 const mappings=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const calendars=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
 const revisions=await db.$queryRaw<{listingId:string;id:string}[]>`SELECT DISTINCT ON ("listingId") "listingId","id" FROM "AdjustmentSnapshot" WHERE "asOf"<=clock_timestamp() AND "createdAt"<=clock_timestamp() ORDER BY "listingId","asOf" DESC,"createdAt" DESC,"id"`;
 const journalRevision=hash(journal.map(r=>r.evidence));
 const history=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionStatusHistory" WHERE "ownerId"=${ownerId}::uuid ORDER BY "recordedAt" DESC,"id" LIMIT 100`;
 const now=new Date().toISOString();
 return {items:rows.map(({evidence})=>{
  const current=evidence.result.lifecycle==='CLOSED'||(evidence.validUntil>now&&exchangeDate(evidence.asOf)===exchangeDate(now)&&evidence.sources.journal===journalRevision&&evidence.sources.mapping===mappings[0]?.id&&evidence.sources.calendar===calendars[0]?.id&&evidence.sources.adjustment===revisions.find(r=>r.listingId===evidence.sources.activeStop?.listingId)?.id);
  return {evidence,current,result:!current?{...evidence.result,health:'MONITOR_DEGRADED',action:evidence.result.action==='HOLD'?'UNABLE_TO_EVALUATE':evidence.result.action,reasons:[...evidence.result.reasons,'STATUS_OBSERVATION_EXPIRED_OR_INPUT_CHANGED']}:evidence.result};
 }),history:history.map(r=>r.evidence),asOf:now,executable:false};
}



