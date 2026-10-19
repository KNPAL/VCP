import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {replay,type Series} from '@vcp/indicators';
import {verifiedCalendar,type CalendarDay} from '@vcp/market-data';
import {STRATEGY_VERSION,utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
type AdjustedBar=Series['bars'][number]&{rawRevisionId:string};
export interface IndicatorReplayInput {eventId:string;adjustmentId:string;calendarHash:string}
export async function pendingIndicatorReplays(db:PrismaClient,limit=25){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('INVALID_REPLAY_LIMIT');
 return db.$queryRaw<IndicatorReplayInput[]>`SELECT r."eventId",a."id" AS "adjustmentId",r."evidence"->>'calendarHash' AS "calendarHash"
 FROM "CorrectionReplayRequest" r
 JOIN LATERAL (SELECT s."id" FROM "AdjustmentSnapshot" s WHERE s."listingId"=r."listingId" AND s."state"='KNOWN' AND s."asOf"<=CURRENT_TIMESTAMP AND (s."evidence"->'rawRevisionIds') @> jsonb_build_array(r."dataRevision"::text) ORDER BY s."asOf" DESC,s."id" DESC LIMIT 1) a ON true
 LEFT JOIN "IndicatorReplayDispatch" d ON d."eventId"=r."eventId" AND d."adjustmentId"=a."id" AND d."calendarHash"=r."evidence"->>'calendarHash'
 WHERE NOT EXISTS (SELECT 1 FROM "IndicatorReplayReceipt" done WHERE done."eventId"=r."eventId" AND done."adjustmentId"=a."id" AND done."calendarHash"=r."evidence"->>'calendarHash')
 ORDER BY COALESCE(d."checkedAt",r."createdAt"),r."eventId" LIMIT ${limit}`;
}
export async function recordIndicatorReplayDispatch(db:PrismaClient,input:IndicatorReplayInput,state:string){
 await db.$executeRaw`INSERT INTO "IndicatorReplayDispatch" ("eventId","adjustmentId","calendarHash","state") VALUES (${input.eventId}::uuid,${input.adjustmentId},${input.calendarHash},${state}) ON CONFLICT ("eventId","adjustmentId","calendarHash") DO UPDATE SET "state"=EXCLUDED."state","checkedAt"=CURRENT_TIMESTAMP`;
}
/** Read-only replay of pinned evidence; original signals and decisions are never mutated. */
export async function replayStoredIndicators(db:PrismaClient,input:IndicatorReplayInput){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.eventId)||![input.adjustmentId,input.calendarHash].every(id=>/^[0-9a-f]{64}$/.test(id)))throw new Error('INVALID_REPLAY_IDENTITY');
 const id=createHash('sha256').update(canonical(input)).digest('hex');
 const prior=await db.$queryRaw<{evidence:Prisma.JsonValue}[]>`SELECT "evidence" FROM "IndicatorReplayReceipt" WHERE "id"=${id}`;
 if(prior[0])return prior[0].evidence;
 const requests=await db.$queryRaw<{listingId:string;changedFrom:Date;dataRevision:string}[]>`SELECT "listingId","changedFrom","dataRevision" FROM "CorrectionReplayRequest" WHERE "eventId"=${input.eventId}::uuid`;
 const request=requests[0];if(!request)throw new Error('REPLAY_REQUEST_MISSING');
 const snapshots=await db.$queryRaw<{listingId:string;asOf:Date;state:string;evidence:{rawRevisionIds:string[];result:{bars:AdjustedBar[]}}}[]>`SELECT "listingId","asOf","state","evidence" FROM "AdjustmentSnapshot" WHERE "id"=${input.adjustmentId}`;
 const snapshot=snapshots[0];
 if(!snapshot||snapshot.listingId!==request.listingId||snapshot.state!=='KNOWN'||snapshot.asOf>new Date()||!snapshot.evidence.rawRevisionIds.includes(request.dataRevision))throw new Error('REPLAY_ADJUSTMENT_UNAVAILABLE');
 const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${input.calendarHash}`;
 const bars=snapshot.evidence.result.bars;
 if(!bars.length)throw new Error('REPLAY_SERIES_EMPTY');
 const asOf=snapshot.asOf.toISOString();
 const calendar=verifiedCalendar(calendars[0]?.evidence??null,bars[0]!.session,bars.at(-1)!.session,asOf);
 if(calendar.state!=='KNOWN'||canonical(calendar.sessions.map(s=>s.date))!==canonical(bars.map(b=>b.session)))throw new Error('REPLAY_CALENDAR_INCOMPLETE');
 if(bars.some(b=>!b.finalizedAt||utcInstant(b.finalizedAt)>utcInstant(asOf)))throw new Error('REPLAY_CANDLE_NOT_FINAL');
 const dataRevision=createHash('sha256').update(input.adjustmentId+'|'+input.calendarHash).digest('hex');
 const series:Series={priceScale:'ADJUSTED',bars:bars.map(b=>({...b,revision:b.rawRevisionId})),sessions:calendar.sessions.map(s=>s.date),asOf,dataRevision};
 // Conservatively restart from the original seed: an action adjustment may affect bars
 // earlier than the raw correction date. Every prefix remains independently auditable.
 const outputs=replay(series,0);
 const receipt={id,...input,listingId:request.listingId,dataRevision,state:'INDICATORS_REPLAYED',mode:'RETROSPECTIVE_CORRECTION',asOf,from:bars[0]!.session,to:bars.at(-1)!.session,count:outputs.length,remainingStages:['MARKET_SIGNALS','VCP','SCANS']};
 return db.$transaction(async tx=>{
  for(const output of outputs){
   const key={listingId:request.listingId,session:new Date(output.session),strategyVersion:STRATEGY_VERSION,dataRevision};
   const evidence=JSON.parse(canonical({...output.evidence,replay:{mode:'RETROSPECTIVE_CORRECTION',adjustmentId:input.adjustmentId,calendarHash:input.calendarHash}})) as Prisma.InputJsonValue;
   await tx.indicatorSnapshot.createMany({data:[{...key,asOf:snapshot.asOf,evidence}],skipDuplicates:true});
   const stored=await tx.indicatorSnapshot.findUniqueOrThrow({where:{listingId_session_strategyVersion_dataRevision:key}});
   if(canonical(stored.evidence)!==canonical(evidence))throw new Error('REPLAY_EVIDENCE_CONFLICT');
  }
  await tx.$executeRaw`INSERT INTO "IndicatorReplayReceipt" ("id","eventId","adjustmentId","calendarHash","evidence") VALUES (${id},${input.eventId}::uuid,${input.adjustmentId},${input.calendarHash},${canonical(receipt)}::jsonb) ON CONFLICT DO NOTHING`;
  return receipt;
 },{timeout:60000});
}
