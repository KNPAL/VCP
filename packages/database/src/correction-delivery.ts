import type {PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
export interface CandleChange {id:string;listingId:string;session:Date;provider:string;beforeRevisionId:string|null;afterRevisionId:string;calendarHash:string;createdAt:Date}
export async function pendingCandleChanges(db:PrismaClient,limit=100,listingId:string|null=null){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('INVALID_DELIVERY_LIMIT');
 return db.$queryRaw<CandleChange[]>`SELECT e.* FROM "CandleChangeOutbox" e LEFT JOIN "CorrectionReplayRequest" r ON r."eventId"=e."id" LEFT JOIN "CandleDispatch" d ON d."eventId"=e."id" WHERE r."eventId" IS NULL AND (${listingId}::uuid IS NULL OR e."listingId"=${listingId}::uuid) ORDER BY COALESCE(d."checkedAt",e."createdAt"),e."id" LIMIT ${limit}`;
}
/** The worker reloads authoritative event data; queue payloads cannot supply financial evidence. */
export async function receiveCandleChange(db:PrismaClient,eventId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(eventId))throw new Error('INVALID_CHANGE_EVENT');
 return db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<CandleChange[]>`SELECT * FROM "CandleChangeOutbox" WHERE "id"=${eventId}::uuid`;
  const event=rows[0];if(!event)throw new Error('CHANGE_EVENT_NOT_FOUND');
  // For each chronological session, compare its close with the frozen prior READY
  // snapshot before recomputing today's VCP. Do not treat this as whole-series stages.
  const request={eventId:event.id,listingId:event.listingId,changedFrom:event.session.toISOString().slice(0,10),dataRevision:event.afterRevisionId,beforeRevisionId:event.beforeRevisionId,provider:event.provider,calendarHash:event.calendarHash,planVersion:2,iteration:'SESSION_ASC',stages:['INDICATORS','MARKET_SIGNALS','VCP','SCANS'],state:'PENDING',reason:'REPLAY_REQUIRED'};
  const evidence=canonical(request);
  await tx.$executeRaw`INSERT INTO "CorrectionReplayRequest" ("eventId","listingId","changedFrom","dataRevision","evidence") VALUES (${eventId}::uuid,${event.listingId}::uuid,${event.session},${event.afterRevisionId}::uuid,${evidence}::jsonb) ON CONFLICT ("eventId") DO NOTHING`;
  const stored=await tx.$queryRaw<{evidence:typeof request}[]>`SELECT "evidence" FROM "CorrectionReplayRequest" WHERE "eventId"=${eventId}::uuid`;
  return stored[0]!.evidence;
 });
}
export async function recordCandleDispatch(db:PrismaClient,eventId:string,result:{jobId:string|null;state:string;attemptsMade:number;reason:string|null}){
 await db.$executeRaw`INSERT INTO "CandleDispatch" ("eventId","jobId","state","attemptsMade","reason") VALUES (${eventId}::uuid,${result.jobId},${result.state},${result.attemptsMade},${result.reason}) ON CONFLICT ("eventId") DO UPDATE SET "jobId"=EXCLUDED."jobId","state"=EXCLUDED."state","attemptsMade"=EXCLUDED."attemptsMade","reason"=EXCLUDED."reason","checkedAt"=CURRENT_TIMESTAMP`;
}
