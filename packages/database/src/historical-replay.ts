import {configurationHash} from '@vcp/strategy';
import {replayDailyChronology,type ReplayAssumption} from '@vcp/backtest';
import type {PrismaClient} from '@prisma/client';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
export async function persistHistoricalReplay(db:PrismaClient,ownerId:string,snapshotId:string,assumptions:readonly ReplayAssumption[]=[]){
 const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT "evidence" FROM "HistoricalReplaySnapshot" WHERE "id"=${snapshotId}::uuid AND "ownerId"=${ownerId}::uuid`;
 if(!rows[0])throw new Error('SNAPSHOT_NOT_FOUND');
 const inputs=structuredClone([...assumptions]).sort((a,b)=>a.session.localeCompare(b.session));
 const id=configurationHash({ownerId,snapshotId,assumptions:inputs});
 const events=replayDailyChronology(rows[0].evidence.snapshot,inputs).map(event=>({...event,id:configurationHash({runId:id,eventId:event.id}),ownerId,runId:id,simulated:true}));
 const evidence={id,ownerId,snapshotId,assumptions:inputs,eventCount:events.length,executable:false,performanceVerified:false};
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{evidence:typeof evidence}[]>`SELECT "evidence" FROM "HistoricalReplayRun" WHERE "id"=${id} AND "ownerId"=${ownerId}::uuid`;
  if(prior[0])return prior[0].evidence;
  await tx.$executeRaw`INSERT INTO "HistoricalReplayRun" ("id","ownerId","snapshotId","evidence") VALUES (${id},${ownerId}::uuid,${snapshotId}::uuid,${JSON.stringify(evidence)}::jsonb)`;
  await tx.$executeRaw`INSERT INTO "HistoricalReplayEvent" ("id","runId","ownerId","session","sourceAt","occurredAt","decidedAt","effectiveAt","strategyRevision","dataRevision","evidence") SELECT value->>'id',${id},${ownerId}::uuid,(value->>'session')::date,(value->>'sourceAt')::timestamptz,(value->>'occurredAt')::timestamptz,(value->>'decidedAt')::timestamptz,(value->>'effectiveAt')::timestamptz,value->>'strategyRevision',value->>'dataRevision',value FROM jsonb_array_elements(${JSON.stringify(events)}::jsonb)`;
  return evidence;
 },{timeout:30000});
}
export async function readHistoricalReplay(db:PrismaClient,ownerId:string,runId:string){
 const rows=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "HistoricalReplayEvent" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "session"`;
 return rows.map(row=>row.evidence);
}
