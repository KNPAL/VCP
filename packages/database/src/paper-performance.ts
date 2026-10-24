import type {PrismaClient} from '@prisma/client';
import {paperPerformance,readPaperLedger,historicalSlice,type PaperLedger,type HistoricalEntryInput,type PerformanceDay,type PerformanceInput,type replayDailyChronology} from '@vcp/backtest';
import {canonicalListings,validateCandle} from '@vcp/market-data';
import {utcInstant,exchangeDate,parseFixed,formatFixed} from '@vcp/domain';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';

/** Reports use immutable simulation evidence, not current quotes or actual user fills. */
export async function readPaperPerformance(db:PrismaClient,ownerId:string,runId:string,asOf:string,manualExecution:PerformanceInput['manualExecution']=null){
 const cutoff=utcInstant(asOf),archives=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
 const snapshot=archives[0]?.evidence.snapshot;if(!snapshot)throw new Error('REPLAY_RUN_NOT_FOUND');
 if(cutoff>utcInstant(snapshot.inputs.knownAt))throw new Error('PERFORMANCE_OUTSIDE_SNAPSHOT');
 const ledgers=await db.$queryRaw<{evidence:PaperLedger}[]>`SELECT "evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("evidence"->'events') e WHERE (e->>'recordedAt')::timestamptz>${cutoff}) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("evidence"->'corporateActions','[]'::jsonb)) a WHERE (a->>'recordedAt')::timestamptz>${cutoff}) ORDER BY "sequence" DESC LIMIT 1`;
 const ledger=ledgers[0]?.evidence;if(!ledger)throw new Error('PAPER_LEDGER_NOT_FOUND');
 const entries=await db.$queryRaw<{id:string;evidence:{marketEventId:string;decidedAt:string;state:string;quantity:number;price:string|null;stop:string|null;assumptions:HistoricalEntryInput}}[]>`SELECT "id","evidence" FROM "HistoricalEntryDecision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND "decidedAt"<=${cutoff} ORDER BY "decidedAt","id"`;
 const replay=await db.$queryRaw<{evidence:ReturnType<typeof replayDailyChronology>[number]}[]>`SELECT "evidence" FROM "HistoricalReplayEvent" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND "decidedAt"<=${cutoff} ORDER BY "session"`;
 const pinned=snapshot.inputs,portfolio=readPaperLedger(ledger,asOf,pinned.calendar),initialRisks=portfolio.cooldown.episodes.flatMap(episode=>{
  const first=ledger.events.find(event=>event.id===episode.id),entry=entries.find(row=>row.id===first?.sourceId)?.evidence;
  if(!entry?.price||!entry.stop)return [];
  return [{episodeId:episode.id,riskAmount:formatFixed((parseFixed(entry.price)-parseFixed(entry.stop))*BigInt(entry.quantity)),knownAt:entry.decidedAt,regime:entry.assumptions.market.regime}];
 });
 const days:PerformanceDay[]=pinned.calendar.filter(day=>day.kind!=='HOLIDAY'&&day.date>=exchangeDate(ledger.events[0]!.occurredAt)&&day.date<=exchangeDate(asOf)&&day.finalizedAt&&utcInstant(day.finalizedAt)<=cutoff).map(day=>{
  const recorded=ledger.events.filter(event=>exchangeDate(event.recordedAt)===day.date&&utcInstant(event.recordedAt)<=cutoff).map(event=>utcInstant(event.recordedAt).valueOf());
  const point=new Date(Math.max(utcInstant(day.finalizedAt!).valueOf(),...recorded)).toISOString(),holdings=readPaperLedger(ledger,point,pinned.calendar).portfolio.holdings;
  const marks=Object.keys(holdings).sort().flatMap(isin=>{
   const listing=canonicalListings(pinned.instruments,[isin],point)[0]?.primary;
   const bar=pinned.raw.filter(row=>row.listingId===listing?.listingId&&row.session===day.date&&row.finalizedAt&&utcInstant(row.finalizedAt)<=utcInstant(point)&&utcInstant(row.receivedAt)<=utcInstant(point)).sort((a,b)=>b.revision-a.revision)[0];
   return bar&&validateCandle(bar,point).valid?[{isin,price:bar.close,sourceAt:bar.finalizedAt!,knownAt:bar.receivedAt,sourceReference:bar.provider+':'+bar.revisionId}]:[];
  });
  const event=replay.find(row=>row.evidence.session===day.date)?.evidence,assumptions=event?.assumptions;
  const regime=assumptions&&'market' in assumptions&&utcInstant(assumptions.knownAt)<=utcInstant(point)?assumptions.market.state:null;
  return {session:day.date,asOf:point,marks,regime:event&&['GREEN','YELLOW','RED','UNKNOWN'].includes(String(regime))?{state:regime as 'GREEN'|'YELLOW'|'RED'|'UNKNOWN',knownAt:event.decidedAt,revision:event.id}:null};
 });
 const signals=new Map<string,{id:string;decidedAt:string}>();
 for(const row of replay)for(const result of row.evidence.results){const event=result.breakout?.event;if(event)signals.set(event.id,{id:event.id,decidedAt:event.decidedAt})}
 const slice=historicalSlice(snapshot,asOf),report=paperPerformance({ledger,asOf,calendar:pinned.calendar,days,initialRisks,signals:[...signals.values()],entryDecisions:entries.map(row=>({id:row.id,...row.evidence})),manualExecution,fees:pinned.fees,bias:slice.bias,limitations:[...slice.reasons,...replay.flatMap(row=>row.evidence.reasons)]});
 return {...report,runId,snapshotId:snapshot.id,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision};
}
