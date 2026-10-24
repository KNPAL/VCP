import {configurationHash} from '@vcp/strategy';
import {simulateDailyExit,historicalSlice,type HistoricalExitInput} from '@vcp/backtest';
import {canonicalListings} from '@vcp/market-data';
import {paperTransaction,type PaperDatabase} from './paper-transaction.js';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
export async function persistHistoricalExit(db:PaperDatabase,ownerId:string,runId:string,input:HistoricalExitInput){
 input=structuredClone(input);
 const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
 const snapshot=rows[0]?.evidence.snapshot;if(!snapshot)throw new Error('REPLAY_RUN_NOT_FOUND');
 const pinned=snapshot.inputs,raw=pinned.raw.find(bar=>bar.revisionId===input.bar.revisionId),day=pinned.calendar.find(day=>day.date===input.bar.session);
 if(!raw||!day||input.snapshotId!==snapshot.id||input.strategyRevision!==snapshot.strategyHash||input.dataRevision!==snapshot.dataRevision||new Date(input.asOf)>new Date(pinned.knownAt)||configurationHash(input.fees)!==configurationHash(pinned.fees)||configurationHash(input.calendar)!==configurationHash(day))throw new Error('EXIT_PIN_MISMATCH');
 for(const key of ['listingId','session','provider','open','high','low','close','volume','receivedAt','finalizedAt','zeroVolumeVerified'] as const)if(raw[key]!==input.bar[key])throw new Error('EXIT_RAW_PIN_MISMATCH');
 const latest=pinned.raw.filter(row=>row.listingId===raw.listingId&&row.session===raw.session&&new Date(row.receivedAt)<=new Date(input.asOf)&&row.finalizedAt&&new Date(row.finalizedAt)<=new Date(input.asOf)).sort((a,b)=>b.revision-a.revision)[0];
 if(latest&&latest.revisionId!==raw.revisionId)throw new Error('EXIT_RAW_REVISION_SUPERSEDED');
 const source=pinned.actions.filter(row=>row.listingId===input.position.listingId&&day.opensAt&&new Date(row.knownAt)<=new Date(day.opensAt)).sort((a,b)=>new Date(b.knownAt).valueOf()-new Date(a.knownAt).valueOf()||a.id.localeCompare(b.id))[0]??null;
 const isins=[...new Set(pinned.instruments.flatMap(row=>row.rows.filter(mapping=>mapping.listingId===input.position.listingId).map(mapping=>mapping.isin)))];
 const mapping=canonicalListings(pinned.instruments,isins,input.asOf).find(row=>row.primary?.listingId===input.position.listingId)?.primary;
 if(configurationHash(source)!==configurationHash(input.actions)||!mapping||mapping.tick!==input.tick||mapping.lot!==input.lotSize)throw new Error('EXIT_MARKET_PIN_MISMATCH');
 const slice=historicalSlice(snapshot,input.asOf);input.bias=slice.bias;
 const decision=simulateDailyExit(input),id=configurationHash({runId,positionId:input.position.id,session:input.bar.session}),evidence={...decision,id,decisionHash:decision.id,ownerId,runId,limitations:slice.reasons};
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{evidence:typeof evidence}[]>`SELECT "evidence" FROM "HistoricalExitDecision" WHERE "id"=${id}`;
  if(prior[0]){if(prior[0].evidence.decisionHash!==decision.id)throw new Error('EXIT_RETRY_CONFLICT');return prior[0].evidence}
  await tx.$executeRaw`INSERT INTO "HistoricalExitDecision" ("id","ownerId","runId","positionId","session","sourceAt","occurredAt","decidedAt","effectiveAt","strategyRevision","dataRevision","evidence") VALUES (${id},${ownerId}::uuid,${runId},${input.position.id},${new Date(input.bar.session)},${new Date(decision.sourceAt)},${new Date(decision.occurredAt)},${new Date(decision.decidedAt)},${new Date(decision.effectiveAt)},${decision.strategyRevision},${decision.dataRevision},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
