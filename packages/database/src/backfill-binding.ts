import type {PrismaClient} from '@prisma/client';
import {sourcePermission,HISTORICAL_ENDPOINT,normalizeHistoricalResponse,type InstrumentSnapshot,type SourceRecord} from '@vcp/market-data';
import {syncRunInput} from './sync-windows.js';
import {canonical} from './indicators.js';
export interface BackfillBinding {runId:string;credentialReference:string;instrumentSnapshotId:string;sourceSnapshotId:string;exchange:'NSE'|'BSE';symbolToken:string}
export async function backfillBinding(db:PrismaClient,runId:string){const rows=await db.$queryRaw<{evidence:BackfillBinding}[]>`SELECT "evidence" FROM "BackfillBinding" WHERE "runId"=${runId}::uuid`;return rows[0]?.evidence??null}
export async function backfillContext(db:PrismaClient,binding:BackfillBinding,now:string){
 const run=await syncRunInput(db,binding.runId);if(!run||run.provider!=='ANGEL_ONE')throw new Error('BACKFILL_CONTEXT_UNAVAILABLE');
 const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${binding.instrumentSnapshotId}`;
 const sources=await db.$queryRaw<{evidence:SourceRecord}[]>`SELECT "evidence" FROM "SourceSnapshot" WHERE "id"=${binding.sourceSnapshotId}`;
 const mapping=mappings[0]?.evidence,source=sources[0]?.evidence;
 if(!mapping||!source||source.provider!==run.provider||source.dataset!=='DAILY_CANDLES'||source.endpointOrFile!==HISTORICAL_ENDPOINT||sourcePermission(source,'DOWNLOAD',now).status!=='PASS'||sourcePermission(source,'STORE',now).status!=='PASS')throw new Error('BACKFILL_CONTEXT_UNAVAILABLE');
 const normalized=normalizeHistoricalResponse({listingId:run.listingId,mapping,calendar:run.calendar,request:{exchange:binding.exchange,symbolToken:binding.symbolToken,from:run.from,to:run.to},receivedAt:now,rows:[]});
 if(normalized.status==='UNKNOWN')throw new Error('BACKFILL_CONTEXT_UNAVAILABLE');
 return {run,mapping,source};
}
/** Trusted operator/application service only; never accepted directly from a queue payload. */
export async function bindBackfill(db:PrismaClient,input:BackfillBinding,now=new Date().toISOString()){
 await backfillContext(db,input,now);
 const credential=await db.$queryRaw<{reference:string}[]>`SELECT "reference" FROM "BrokerCredential" WHERE "reference"=${input.credentialReference}::uuid`;
 if(!credential[0])throw new Error('BROKER_UNAVAILABLE');
 const evidence=canonical(input);
 await db.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "BackfillBinding" ("runId","credentialReference","evidence") VALUES (${input.runId}::uuid,${input.credentialReference}::uuid,${evidence}::jsonb) ON CONFLICT DO NOTHING`;
  const rows=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "BackfillBinding" WHERE "runId"=${input.runId}::uuid`;
  if(canonical(rows[0]?.evidence)!==evidence)throw new Error('BACKFILL_BINDING_CONFLICT');
 });return input;
}
export async function pendingBackfills(db:PrismaClient,limit=100){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('INVALID_BACKFILL_LIMIT');
 return db.$queryRaw<{runId:string;id:string;attempts:number}[]>`SELECT DISTINCT ON (w."runId") w."runId",w."id",w."attempts" FROM "HistoricalSyncWindow" w JOIN "BackfillBinding" b ON b."runId"=w."runId" WHERE ((w."state" IN ('PENDING','PARTIAL') AND w."nextAttemptAt"<=CURRENT_TIMESTAMP) OR (w."state"='RUNNING' AND w."leaseUntil"<=CURRENT_TIMESTAMP)) AND NOT EXISTS (SELECT 1 FROM "HistoricalSyncWindow" active WHERE active."runId"=w."runId" AND active."state"='RUNNING' AND active."leaseUntil">CURRENT_TIMESTAMP) ORDER BY w."runId",w."fromSession",w."id" LIMIT ${limit}`;
}
