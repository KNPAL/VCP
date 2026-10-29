import {createSyncRun,claimSyncWindow,commitSyncWindow,failSyncWindow,syncRunInput,type PrismaClient} from '@vcp/database';
import {planBackfill,backfillHorizon,type CalendarDay,type DailyCandle,type BackfillWindow} from '@vcp/market-data';
import {HistoricalWindowError} from './historical-gateway.js';
export async function prepareBackfill(db:PrismaClient,input:{id:string;listingId:string;provider:string;to:string;asOf:string;calendar:readonly CalendarDay[];availableFrom?:string}){
 const existing=await syncRunInput(db,input.id);
 if(existing){const from=[backfillHorizon(input.to).from,input.availableFrom??''].sort().at(-1)!;if(existing.mode||existing.listingId!==input.listingId||existing.provider!==input.provider||existing.to!==input.to||existing.from!==from||existing.asOf!==input.asOf)throw new Error('STALE_CONFLICT: sync identity changed');await createSyncRun(db,{...existing,calendar:input.calendar});return {state:'RESUMED',runId:input.id}}
 const rows=await db.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${input.listingId}::uuid AND "provider"=${input.provider} AND "finalizedAt"<=${new Date(input.asOf)} AND "receivedAt"<=${new Date(input.asOf)}`;
 const plan=planBackfill({...input,storedSessions:rows.map(row=>row.session.toISOString().slice(0,10))});
 if(plan.state==='UNKNOWN')return {state:'UNKNOWN',reason:'CALENDAR_UNKNOWN',plan};
 await createSyncRun(db,{id:input.id,listingId:input.listingId,provider:input.provider,from:plan.from,to:plan.to,asOf:input.asOf,calendar:input.calendar,windows:plan.windows});
 return {state:'QUEUED',runId:input.id,plan};
}
/** One bounded unit of resumable work; fetch must be the normalized, licensed broker gateway. */
export async function processBackfillWindow(db:PrismaClient,runId:string,gateway:{fetch:(window:BackfillWindow)=>Promise<readonly DailyCandle[]>;now:()=>string}){
 const claimed=await claimSyncWindow(db,runId);if(!claimed)return {state:'IDLE' as const};
 const window={from:claimed.fromSession.toISOString().slice(0,10),to:claimed.toSession.toISOString().slice(0,10),sessions:claimed.expectedSessions};
 let bars:readonly DailyCandle[];
 try{bars=await gateway.fetch(window)}catch(error){const reason=error instanceof HistoricalWindowError?error.reason:error instanceof Error&&error.message==='BACKFILL_SOURCE_SUPERSEDED'?'BACKFILL_SOURCE_SUPERSEDED':'BROKER_UNAVAILABLE';await failSyncWindow(db,claimed.id,claimed.leaseToken!,reason,error instanceof HistoricalWindowError?error.retryAfterMs:1000);return {state:'FAILED' as const,reason,windowId:claimed.id}}
 try{return {state:'COMMITTED' as const,windowId:claimed.id,report:await commitSyncWindow(db,claimed.id,claimed.leaseToken!,bars,gateway.now())}}
 catch(error){if(error instanceof Error){const reason=error.message;if(reason==='BROKER_RESPONSE_SCOPE_MISMATCH'||reason==='SOURCE_PERMISSION_REQUIRED'||reason==='SOURCE_SCOPE_AMBIGUOUS'||reason==='SOURCE_LINEAGE_MISSING'){await failSyncWindow(db,claimed.id,claimed.leaseToken!,reason);return {state:'FAILED' as const,reason,windowId:claimed.id}}}throw error}
}
