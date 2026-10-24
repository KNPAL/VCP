import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {pinHistoricalSnapshot,historicalSlice,type HistoricalInputs,type HistoricalSnapshot} from '@vcp/backtest';

export interface StoredHistoricalSnapshot {id:string;ownerId:string;requestId:string;sourceAt:string;occurredAt:string;decidedAt:string;effectiveAt:string;strategyRevision:string;dataRevision:string;snapshot:HistoricalSnapshot;executable:false}
/** Caller supplies explicit archived evidence; this never imports contemporary data as historical truth. */
export async function persistHistoricalSnapshot(db:PrismaClient,ownerId:string,requestId:string,input:HistoricalInputs){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw new Error('INVALID_SNAPSHOT_REQUEST_ID');
 const snapshot=pinHistoricalSnapshot(input);
 return db.$transaction(async tx=>{
  const owners=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  if(!owners.length)throw new Error('OWNER_NOT_FOUND');
  const previous=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT "evidence" FROM "HistoricalReplaySnapshot" WHERE "ownerId"=${ownerId}::uuid AND "requestId"=${requestId}`;
  if(previous[0]){if(previous[0].evidence.snapshot.id!==snapshot.id)throw new Error('SNAPSHOT_REQUEST_CONFLICT');return previous[0].evidence}
  const now=new Date().toISOString();if(new Date(input.knownAt).valueOf()>new Date(now).valueOf())throw new Error('SNAPSHOT_FUTURE_INPUT');
  const evidence:StoredHistoricalSnapshot={id:randomUUID(),ownerId,requestId,sourceAt:input.knownAt,occurredAt:now,decidedAt:now,effectiveAt:now,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,snapshot,executable:false};
  await tx.$executeRaw`INSERT INTO "HistoricalReplaySnapshot" ("id","ownerId","requestId","snapshotHash","sourceAt","occurredAt","decidedAt","effectiveAt","strategyRevision","dataRevision","evidence") VALUES (${evidence.id}::uuid,${ownerId}::uuid,${requestId},${snapshot.id},${new Date(evidence.sourceAt)},${new Date(now)},${new Date(now)},${new Date(now)},${evidence.strategyRevision},${evidence.dataRevision},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
export async function readHistoricalSlice(db:PrismaClient,ownerId:string,id:string,asOf:string){
 const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT "evidence" FROM "HistoricalReplaySnapshot" WHERE "ownerId"=${ownerId}::uuid AND "id"=${id}::uuid`;
 if(!rows[0])throw new Error('SNAPSHOT_NOT_FOUND');
 return historicalSlice(rows[0].evidence.snapshot,asOf);
}
