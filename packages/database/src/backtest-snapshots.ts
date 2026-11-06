import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {pinHistoricalSnapshot,historicalSlice,type HistoricalInputs,type HistoricalSnapshot} from '@vcp/backtest';
import {assertProviderPermissions} from './data-permissions.js';
import type {Permission,SourceRecord} from '@vcp/market-data';
import {registeredSourceReasons,assertRegisteredSourceIds,lockProviderAuthority} from './source-authority.js';

export interface StoredHistoricalSnapshot {id:string;ownerId:string;requestId:string;sourceAt:string;occurredAt:string;decidedAt:string;effectiveAt:string;strategyRevision:string;dataRevision:string;snapshot:HistoricalSnapshot;executable:false}
/** An archived market-data cutoff cannot bypass current display rights. */
export async function assertHistoricalDisplay(db:PrismaClient,stored:StoredHistoricalSnapshot){
 await assertHistoricalPermissions(db,stored.snapshot.inputs,['DISPLAY','DERIVE']);
}
export async function assertHistoricalPermissions(db:Pick<PrismaClient,'$queryRaw'>,input:HistoricalInputs,operations:readonly Permission[]){
 const raw=input?.raw;if(!Array.isArray(raw))throw new Error('SOURCE_LINEAGE_MISSING');
 for(const provider of new Set(raw.map(bar=>bar.provider)))await assertProviderPermissions(db,'DAILY_CANDLES',provider,operations);
 for(const [dataset,records] of [['instrument-master',input.instruments],['UNIVERSE',input.universes]] as const){
  for(const record of records){const source=record.source;if(!source||source.dataset!==dataset)throw new Error('SOURCE_LINEAGE_MISSING');if((await registeredSourceReasons(db,source,operations,new Date().toISOString())).length)throw new Error('SOURCE_PERMISSION_REQUIRED')}
 }
 await assertRegisteredSourceIds(db,'EXCHANGE_CALENDAR',input.calendar.map(day=>day.sourceSnapshotId),operations);
 await assertRegisteredSourceIds(db,'CORPORATE_ACTIONS',input.actions.map(action=>action.sourceSnapshotId),operations);
}
/** Keep registry changes behind the archive commit, including newly added endpoints. */
export async function lockHistoricalAuthority(db:Pick<PrismaClient,'$queryRaw'|'$executeRaw'>,input:HistoricalInputs){
 const ids=[...input.calendar.map(day=>day.sourceSnapshotId),...input.actions.map(action=>action.sourceSnapshotId)].filter((id):id is string=>typeof id==='string');
 const registered=ids.length?await db.$queryRaw<{evidence:SourceRecord}[]>`SELECT evidence FROM "SourceSnapshot" WHERE id=ANY(${ids}::text[])`:[];
 const scopes=[...input.raw.map(bar=>({dataset:'DAILY_CANDLES',provider:bar.provider})),...input.instruments.flatMap(row=>row.source?[row.source]:[]),...input.universes.flatMap(row=>row.source?[row.source]:[]),...registered.map(row=>row.evidence)];
 for(const dataset of [...new Set(scopes.map(scope=>scope.dataset))].sort())await lockProviderAuthority(db,dataset,scopes.filter(scope=>scope.dataset===dataset).map(scope=>scope.provider),'READ');
}
/** Caller supplies explicit archived evidence; this never imports contemporary data as historical truth. */
export async function persistHistoricalSnapshot(db:PrismaClient,ownerId:string,requestId:string,input:HistoricalInputs){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw new Error('INVALID_SNAPSHOT_REQUEST_ID');
 const snapshot=pinHistoricalSnapshot(input);
 await assertHistoricalPermissions(db,snapshot.inputs,['STORE','DERIVE']);
 return db.$transaction(async tx=>{
  const owners=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  if(!owners.length)throw new Error('OWNER_NOT_FOUND');
  await lockHistoricalAuthority(tx,snapshot.inputs);
  await assertHistoricalPermissions(tx,snapshot.inputs,['STORE','DERIVE']);
  const previous=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT "evidence" FROM "HistoricalReplaySnapshot" WHERE "ownerId"=${ownerId}::uuid AND "requestId"=${requestId}`;
  if(previous[0]){if(previous[0].evidence.snapshot.id!==snapshot.id)throw new Error('SNAPSHOT_REQUEST_CONFLICT');return previous[0].evidence}
  const now=new Date().toISOString();if(new Date(input.knownAt).valueOf()>new Date(now).valueOf())throw new Error('SNAPSHOT_FUTURE_INPUT');
  const evidence:StoredHistoricalSnapshot={id:randomUUID(),ownerId,requestId,sourceAt:input.knownAt,occurredAt:now,decidedAt:now,effectiveAt:now,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,snapshot,executable:false};
  await tx.$executeRaw`INSERT INTO "HistoricalReplaySnapshot" ("id","ownerId","requestId","snapshotHash","sourceAt","occurredAt","decidedAt","effectiveAt","strategyRevision","dataRevision","evidence") VALUES (${evidence.id}::uuid,${ownerId}::uuid,${requestId},${snapshot.id},${new Date(evidence.sourceAt)},${new Date(now)},${new Date(now)},${new Date(now)},${evidence.strategyRevision},${evidence.dataRevision},${JSON.stringify(evidence)}::jsonb)`;
  await assertHistoricalPermissions(tx,snapshot.inputs,['STORE','DERIVE']);
  return evidence;
 });
}
export async function readHistoricalSlice(db:PrismaClient,ownerId:string,id:string,asOf:string){
 const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT "evidence" FROM "HistoricalReplaySnapshot" WHERE "ownerId"=${ownerId}::uuid AND "id"=${id}::uuid`;
 if(!rows[0])throw new Error('SNAPSHOT_NOT_FOUND');
 await assertHistoricalDisplay(db,rows[0].evidence);
 return historicalSlice(rows[0].evidence.snapshot,asOf);
}
