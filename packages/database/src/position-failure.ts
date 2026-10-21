import {cancelPartialsForStop} from './partial-resolution.js';
import {hasHigherExit} from './exit-decisions.js';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {breakoutFailure,type openEpisode} from '@vcp/portfolio';
import type {Series} from '@vcp/indicators';
import {verifiedCalendar,type CalendarDay} from '@vcp/market-data';
import {exchangeDate} from '@vcp/domain';
import {PROFILE_VERSION} from '@vcp/strategy';
import type {DailyStructureResult} from './daily-structure.js';
import type {InitialStop} from './protective-stops.js';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
/** Internal EOD path, called under the portfolio owner lock with validated final bars. */
export async function recordBreakoutFailure(tx:Prisma.TransactionClient,ownerId:string,record:InitialStop,episode:NonNullable<ReturnType<typeof openEpisode>>,series:Series,calendar:CalendarDay[],scaleVerified:boolean,asOf:string){
 const sources=await tx.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "id"=${record.sourceId}`;
 const pivot=sources[0]?.evidence.detector.frozen.primary?.pivot??null,buySession=exchangeDate(episode.first.occurredAt);
 const verified=verifiedCalendar(calendar,buySession,exchangeDate(asOf),asOf);
 const future=calendar.filter(d=>d.date>buySession&&d.kind!=='HOLIDAY').sort((a,b)=>a.date.localeCompare(b.date));
 const allKnown=future.length&&verifiedCalendar(calendar,buySession,future.at(-1)!.date,asOf).state==='KNOWN';
 const input={buySession,pivot,scaleVerified:scaleVerified&&verified.state==='KNOWN',asOf,
  sessions:verified.sessions.map(day=>({date:day.date,close:series.bars.find(b=>b.session===day.date)?.close??null,closedAt:day.closesAt!,finalizedAt:day.finalizedAt!})),
  nextSessions:allKnown?future.map(d=>({date:d.date,opensAt:d.opensAt!})):[]};
 const result=breakoutFailure(input),session=series.sessions.at(-1)!;
 const id=hash(result.state==='SELL_BREAKOUT_FAILURE'?[record.id,'SELL_BREAKOUT_FAILURE']:[record.id,'BREAKOUT_FAILURE',series.dataRevision,result.state,result.reasons]);
 const evidence={id,ownerId,isin:record.isin,stopId:record.id,episodeId:record.episodeId,input,result,dataRevision:series.dataRevision,executable:false as const};
 const inserted=await tx.$executeRaw`INSERT INTO "PositionFailure" ("id","ownerId","stopId","session","recognizedAt","effectiveAt","state","evidence") VALUES (${id},${ownerId}::uuid,${record.id},${new Date(session)},${new Date(asOf)},${result.effectiveAt?new Date(result.effectiveAt):null},${result.state},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
 if(result.state==='SELL_BREAKOUT_FAILURE')await cancelPartialsForStop(tx,record.id,id,asOf);
 if(inserted&&result.state==='SELL_BREAKOUT_FAILURE'&&!await hasHigherExit(tx,record.id,'SELL_BREAKOUT_FAILURE')){
  const trigger=input.sessions.find(d=>d.date===result.triggerSession)!;
  await appendAlert(tx,{...evidence,sourceEventId:id,kind:'SELL',sourceAt:trigger.finalizedAt,occurredAt:trigger.finalizedAt,decidedAt:asOf,effectiveAt:result.effectiveAt!,strategyVersion:PROFILE_VERSION,configHash:record.configHash},[ownerId]);
 }
 const saved=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PositionFailure" WHERE "id"=${id}`;
 return saved[0]!.evidence;
}

