import {randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {verifiedCalendar,calendarDays,splitBackfillWindow,type CalendarDay,type BackfillWindow,type DailyCandle} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {ingestCandles,type IngestReport} from './candles.js';
export interface SyncRunInput {id:string;listingId:string;provider:string;from:string;to:string;asOf:string;calendar:readonly CalendarDay[];windows:readonly BackfillWindow[];mode?:'INCREMENTAL'}
export interface SyncWindowRow {id:string;runId:string;parentId:string|null;fromSession:Date;toSession:Date;expectedSessions:string[];state:string;attempts:number;leaseToken:string|null;leaseUntil:Date|null;reason:string|null;report:unknown;nextAttemptAt:Date}
export async function createSyncRun(db:PrismaClient,input:SyncRunInput){
 const calendar=verifiedCalendar(input.calendar,input.from,input.to,input.asOf);
 if(calendar.state!=='KNOWN'||!input.provider.trim())throw new Error('SYNC_CALENDAR_UNKNOWN');
 for(const window of input.windows){const expected=calendar.sessions.filter(day=>day.date>=window.from&&day.date<=window.to).map(day=>day.date);if(window.from<input.from||window.to>input.to||calendarDays(window.from,window.to)<1||calendarDays(window.from,window.to)>400||!expected.length||canonical(expected)!==canonical(window.sessions))throw new Error('INVALID_SYNC_WINDOW')}
 const evidence=canonical(input);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "HistoricalSyncRun" ("id","listingId","provider","fromSession","toSession","asOf","evidence") VALUES (${input.id}::uuid,${input.listingId}::uuid,${input.provider},${new Date(input.from)},${new Date(input.to)},${new Date(input.asOf)},${evidence}::jsonb) ON CONFLICT DO NOTHING`;
  const rows=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "HistoricalSyncRun" WHERE "id"=${input.id}::uuid`;
  if(canonical(rows[0]?.evidence)!==evidence)throw new Error('STALE_CONFLICT: sync request changed');
  for(const window of input.windows)await insertWindow(tx,input.id,null,window);
  return input.id;
 });
}
async function insertWindow(tx:Prisma.TransactionClient,runId:string,parentId:string|null,window:BackfillWindow){
 await tx.$executeRaw`INSERT INTO "HistoricalSyncWindow" ("id","runId","parentId","fromSession","toSession","expectedSessions","state") VALUES (${randomUUID()}::uuid,${runId}::uuid,${parentId}::uuid,${new Date(window.from)},${new Date(window.to)},${canonical(window.sessions)}::jsonb,'PENDING') ON CONFLICT ("runId","fromSession","toSession") DO NOTHING`;
}
export async function claimSyncWindow(db:PrismaClient,runId:string,leaseMs=300000){
 if(!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>600000)throw new Error('INVALID_SYNC_LEASE');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${runId},1))`;
  const parents=await tx.$queryRaw<{state:string;current:boolean}[]>`SELECT m."state",c."generation"=(SELECT max(other."generation") FROM "ManualDownloadChild" other WHERE other."manualRunId"=m."id") AS current FROM "ManualDownloadRun" m JOIN "ManualDownloadChild" c ON c."manualRunId"=m."id" WHERE c."syncRunId"=${runId}::uuid FOR UPDATE OF m`;
  if(parents[0]&&(parents[0].state!=='RUNNING'||!parents[0].current))return null;
  const active=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "HistoricalSyncWindow" WHERE "runId"=${runId}::uuid AND "state"='RUNNING' AND "leaseUntil">CURRENT_TIMESTAMP LIMIT 1`;
  if(active.length)return null;
  const rows=await tx.$queryRaw<SyncWindowRow[]>`SELECT * FROM "HistoricalSyncWindow" WHERE "runId"=${runId}::uuid AND (("state" IN ('PENDING','PARTIAL') AND "nextAttemptAt"<=CURRENT_TIMESTAMP) OR ("state"='RUNNING' AND "leaseUntil"<=CURRENT_TIMESTAMP)) ORDER BY "fromSession","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
  const row=rows[0];if(!row)return null;
  if(row.state==='RUNNING')await attempt(tx,row,'LEASE_EXPIRED',{reason:'LEASE_EXPIRED'});
  if(await exhausted(tx,row.id)){await tx.$executeRaw`UPDATE "HistoricalSyncWindow" SET "state"='FAILED',"reason"='RETRY_EXHAUSTED',"leaseToken"=NULL,"leaseUntil"=NULL WHERE "id"=${row.id}::uuid`;return null}
  const token=randomUUID();
  const claimed=await tx.$queryRaw<SyncWindowRow[]>`UPDATE "HistoricalSyncWindow" SET "state"='RUNNING',"attempts"="attempts"+1,"leaseToken"=${token}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+${leaseMs}*interval '1 millisecond',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid RETURNING *`;
  return claimed[0]!;
 });
}
async function locked(tx:Prisma.TransactionClient,id:string,token:string){
 const rows=await tx.$queryRaw<SyncWindowRow[]>`SELECT * FROM "HistoricalSyncWindow" WHERE "id"=${id}::uuid AND "leaseToken"=${token}::uuid AND "state"='RUNNING' AND "leaseUntil">clock_timestamp() FOR UPDATE`;
 if(!rows[0])throw new Error('STALE_SYNC_LEASE');return rows[0];
}
async function attempt(tx:Prisma.TransactionClient,row:SyncWindowRow,outcome:string,evidence:unknown){await tx.$executeRaw`INSERT INTO "HistoricalSyncAttempt" ("windowId","attempt","leaseToken","outcome","evidence") VALUES (${row.id}::uuid,${row.attempts},${row.leaseToken}::uuid,${outcome},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`}
async function exhausted(tx:Prisma.TransactionClient,id:string){const rows=await tx.$queryRaw<{count:number}[]>`SELECT COUNT(*)::integer AS "count" FROM "HistoricalSyncAttempt" WHERE "windowId"=${id}::uuid AND "outcome" IN ('FAILED','LEASE_EXPIRED')`;return rows[0]!.count>=4}
export async function failSyncWindow(db:PrismaClient,id:string,token:string,reason:'BROKER_UNAVAILABLE'|'BROKER_RESPONSE_SCOPE_MISMATCH'|'INVALID_BROKER_RESPONSE'|'RATE_LIMITED'|'BACKFILL_SOURCE_SUPERSEDED'|'SOURCE_PERMISSION_REQUIRED'|'SOURCE_SCOPE_AMBIGUOUS'|'SOURCE_LINEAGE_MISSING',retryAfterMs=1000){
 if(!Number.isSafeInteger(retryAfterMs)||retryAfterMs<0||retryAfterMs>86400000)throw new Error('INVALID_SYNC_RETRY');
 return db.$transaction(async tx=>{const row=await locked(tx,id,token);await attempt(tx,row,reason==='RATE_LIMITED'?'DEFERRED':'FAILED',{reason,retryAfterMs});
  const state=await exhausted(tx,id)?'FAILED':'PARTIAL';
  await tx.$executeRaw`UPDATE "HistoricalSyncWindow" SET "state"=${state},"reason"=${reason},"leaseToken"=NULL,"leaseUntil"=NULL,"nextAttemptAt"=CURRENT_TIMESTAMP+${retryAfterMs}*interval '1 millisecond',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${id}::uuid`;
 });
}
/** Checkpoint and candle mutations commit together; a lost/stale worker cannot advance either. */
export async function commitSyncWindow(db:PrismaClient,id:string,token:string,bars:readonly DailyCandle[],asOf:string){
 const rows=await db.$queryRaw<(SyncWindowRow&{evidence:SyncRunInput})[]>`SELECT w.*,r."evidence" FROM "HistoricalSyncWindow" w JOIN "HistoricalSyncRun" r ON r."id"=w."runId" WHERE w."id"=${id}::uuid`;
 const row=rows[0];if(!row)throw new Error('SYNC_WINDOW_NOT_FOUND');const run=row.evidence;
 if(new Date(asOf)<new Date(run.asOf))throw new Error('SYNC_CLOCK_REGRESSION');
 if(bars.some(bar=>bar.listingId!==run.listingId||bar.provider!==run.provider||bar.session<row.fromSession.toISOString().slice(0,10)||bar.session>row.toSession.toISOString().slice(0,10)))throw new Error('BROKER_RESPONSE_SCOPE_MISMATCH');
 return ingestCandles(db,{listingId:run.listingId,provider:run.provider,from:run.from,to:row.toSession.toISOString().slice(0,10),calendar:run.calendar,asOf,bars,requestedSessions:row.expectedSessions},async(tx,report)=>{
  const current=await locked(tx,id,token);await finish(tx,current,report);
 });
}
async function finish(tx:Prisma.TransactionClient,row:SyncWindowRow,report:IngestReport){
 const children=report.missing.length?splitBackfillWindow({from:row.fromSession.toISOString().slice(0,10),to:row.toSession.toISOString().slice(0,10),sessions:row.expectedSessions},report.missing.map(item=>item.session)):[];
 const state=report.state==='COMPLETE'?'COMPLETE':children.length?'SPLIT':'FAILED';
 const reason=state==='COMPLETE'?null:report.calendarReasons.length?'CALENDAR_UNKNOWN':report.quarantined?'MALFORMED_CANDLE':'PROVIDER_GAP';
 await attempt(tx,row,state,report);
 for(const child of children)await insertWindow(tx,row.runId,row.id,child);
 await tx.$executeRaw`UPDATE "HistoricalSyncWindow" SET "state"=${state},"reason"=${reason},"report"=${canonical(report)}::jsonb,"leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid`;
}
export async function syncRunInput(db:PrismaClient,id:string){const rows=await db.$queryRaw<{evidence:SyncRunInput}[]>`SELECT "evidence" FROM "HistoricalSyncRun" WHERE "id"=${id}::uuid`;return rows[0]?.evidence??null}
