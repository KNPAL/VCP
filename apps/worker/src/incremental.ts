import {createSyncRun,syncRunInput,type PrismaClient} from '@vcp/database';
import {planSynchronization,type CalendarDay} from '@vcp/market-data';
export interface IncrementalInput {id:string;listingId:string;provider:string;from:string;to:string;asOf:string;calendar:readonly CalendarDay[]}
/** Durable planning only; the existing bound-window dispatcher owns gateway execution. */
export async function prepareIncremental(db:PrismaClient,input:IncrementalInput){
 const existing=await syncRunInput(db,input.id);
 if(existing){
  if(existing.mode!=='INCREMENTAL'||existing.listingId!==input.listingId||existing.provider!==input.provider||existing.from!==input.from||existing.to!==input.to||existing.asOf!==input.asOf)throw new Error('STALE_CONFLICT: sync identity changed');
  await createSyncRun(db,{...existing,calendar:input.calendar});
  return {state:'RESUMED' as const,runId:input.id};
 }
 const rows=await db.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${input.listingId}::uuid AND "provider"=${input.provider} AND "session">=${new Date(input.from)} AND "session"<=${new Date(input.to)} AND "finalizedAt"<=${new Date(input.asOf)} AND "receivedAt"<=${new Date(input.asOf)}`;
 const plan=planSynchronization({...input,storedSessions:rows.map(row=>row.session.toISOString().slice(0,10))});
 if(plan.state==='UNKNOWN')return {state:'UNKNOWN' as const,reason:'CALENDAR_UNKNOWN',plan};
 if(!plan.ranges.length)return {state:'IDLE' as const,reason:'NO_FINALIZED_SESSIONS',plan};
 await createSyncRun(db,{...input,mode:'INCREMENTAL',windows:plan.ranges});
 return {state:'QUEUED' as const,runId:input.id,plan};
}
