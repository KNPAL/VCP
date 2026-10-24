import {configurationHash} from '@vcp/strategy';
import {canonicalListings} from '@vcp/market-data';
import {simulateOpeningEntry,type HistoricalEntryInput,type replayDailyChronology} from '@vcp/backtest';
import {paperTransaction,type PaperDatabase} from './paper-transaction.js';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
export async function persistHistoricalEntry(db:PaperDatabase,ownerId:string,runId:string,replayEventId:string,input:HistoricalEntryInput){
 input=structuredClone(input);
 const rows=await db.$queryRaw<{event:ReturnType<typeof replayDailyChronology>[number];snapshot:StoredHistoricalSnapshot}[]>`SELECT e."evidence" AS event,s."evidence" AS snapshot FROM "HistoricalReplayEvent" e JOIN "HistoricalReplayRun" r ON r."id"=e."runId" JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE e."id"=${replayEventId} AND e."runId"=${runId} AND e."ownerId"=${ownerId}::uuid`;
 const source=rows[0];if(!source)throw new Error('REPLAY_EVENT_NOT_FOUND');
 const result=source.event.results.find(row=>row.breakout?.event?.id===input.event.id);
 if(!result?.breakout?.event||configurationHash(result.breakout.event)!==configurationHash(input.event)||input.snapshotId!==source.snapshot.snapshot.id||input.earliestFillAt!==result.earliestFillAt||configurationHash(input.fees)!==configurationHash(source.snapshot.snapshot.inputs.fees))throw new Error('ENTRY_PIN_MISMATCH');
 const pinned=source.snapshot.snapshot.inputs,now=new Date(input.now).valueOf();
 const mapping=canonicalListings(pinned.instruments,[input.isin],input.now)[0]?.primary;
 const calendar=pinned.calendar.filter(day=>day.kind!=='HOLIDAY'&&day.verified&&day.source&&new Date(day.knownAt).valueOf()<=now&&day.opensAt&&day.closesAt).sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({date:day.date,opensAt:day.opensAt,closesAt:day.closesAt}));
 if(now>new Date(pinned.knownAt).valueOf()||result.isin!==input.isin||mapping?.listingId!==input.event.listingId||mapping.tick!==input.market.tick||mapping.lot!==input.lotSize||configurationHash(calendar)!==configurationHash(input.market.calendar))throw new Error('ENTRY_MARKET_PIN_MISMATCH');
 const decision=simulateOpeningEntry(input),id=configurationHash({runId,marketEventId:input.event.id}),evidence={...decision,id,decisionHash:decision.id,ownerId,runId,replayEventId,bias:source.event.bias,limitations:source.event.reasons};
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{evidence:typeof evidence}[]>`SELECT "evidence" FROM "HistoricalEntryDecision" WHERE "id"=${id}`;
  if(prior[0]){if(prior[0].evidence.decisionHash!==decision.id)throw new Error('ENTRY_RETRY_CONFLICT');return prior[0].evidence}
  await tx.$executeRaw`INSERT INTO "HistoricalEntryDecision" ("id","ownerId","runId","replayEventId","marketEventId","sourceAt","occurredAt","decidedAt","effectiveAt","strategyRevision","dataRevision","evidence") VALUES (${id},${ownerId}::uuid,${runId},${replayEventId},${input.event.id},${new Date(decision.sourceAt)},${new Date(decision.occurredAt)},${new Date(decision.decidedAt)},${new Date(decision.effectiveAt)},${decision.strategyRevision},${decision.dataRevision},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
