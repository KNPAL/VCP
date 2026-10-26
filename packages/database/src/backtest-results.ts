import type {PrismaClient} from '@prisma/client';
import {historicalSlice,type PaperLedger} from '@vcp/backtest';
import {configurationHash} from '@vcp/strategy';
import {utcInstant,exchangeDate,parseFixed} from '@vcp/domain';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
import {readPaperPerformance} from './paper-performance.js';
const runKey=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw new Error('INVALID_REPLAY_RUN_ID')};
function metadata(id:string,stored:StoredHistoricalSnapshot){const s=stored.snapshot,p=s.inputs;return {id,snapshotId:stored.id,snapshotHash:s.id,strategyRevision:s.strategyHash,strategySha:p.strategySha,dataRevision:s.dataRevision,universeRevision:configurationHash(p.universes),calendarRevision:configurationHash(p.calendar),from:p.from,through:p.through,historyFrom:p.historyFrom??p.from,sourceAt:p.knownAt,evaluationAsOf:new Date(Math.min(Date.parse(p.knownAt),Date.parse(p.through+'T18:29:59.999Z'))).toISOString(),costs:p.fees,standardSlippage:parseFixed(p.fees.slippageBps)===10000000n,executable:false}}
export async function listBacktestRuns(db:PrismaClient,ownerId:string){
 const rows=await db.$queryRaw<{id:string;evidence:StoredHistoricalSnapshot}[]>`SELECT r."id",s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" AND s."ownerId"=r."ownerId" WHERE r."ownerId"=${ownerId}::uuid ORDER BY s."occurredAt" DESC,r."id" LIMIT 201`;
 return {items:rows.slice(0,200).map(r=>metadata(r.id,r.evidence)),truncated:rows.length>200,executable:false};
}
async function archive(db:PrismaClient,ownerId:string,runId:string,asOf:string){
 runKey(runId);utcInstant(asOf);
 const rows=await db.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" AND s."ownerId"=r."ownerId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
 const stored=rows[0]?.evidence;if(!stored)throw new Error('REPLAY_RUN_NOT_FOUND');
 const slice=historicalSlice(stored.snapshot,asOf);return {stored,slice};
}
export async function readBacktestResult(db:PrismaClient,ownerId:string,runId:string,asOf:string){
 const {stored,slice}=await archive(db,ownerId,runId,asOf);
 let report:Awaited<ReturnType<typeof readPaperPerformance>>|null=null;
 const reasons=[...slice.reasons];
 try{report=await readPaperPerformance(db,ownerId,runId,asOf)}catch(error){if(!(error instanceof Error)||error.message!=='PAPER_LEDGER_NOT_FOUND')throw error;reasons.push('PAPER_LEDGER_NOT_FOUND')}
 const entries=await db.$queryRaw<{id:string;evidence:{state:string;reasons:string[];decidedAt:string;assumptions:{isin:string}}}[]>`SELECT "id","evidence" FROM "HistoricalEntryDecision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND "decidedAt"<=${utcInstant(asOf)} ORDER BY "decidedAt","id"`;
 const meta=metadata(runId,stored);if(!meta.standardSlippage)reasons.push('NONSTANDARD_SLIPPAGE_RESEARCH');
 return {...meta,asOf,state:report?.state??'UNKNOWN',report,reasons:[...new Set([...reasons,...(report?.limitations??[])])],instruments:slice.selected.map(row=>({isin:row.isin,listingId:row.listingId,state:row.adjustment?.state??'UNKNOWN'})),blockedEntries:entries.filter(row=>row.evidence.state!=='SIMULATED_FILL').map(row=>({id:row.id,isin:row.evidence.assumptions.isin,state:row.evidence.state,decidedAt:row.evidence.decidedAt,reasons:row.evidence.reasons})),performanceVerified:false};
}
export async function readBacktestInstrument(db:PrismaClient,ownerId:string,runId:string,isin:string,asOf:string){
 if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin))throw new Error('INVALID_ISIN');
 const {stored,slice}=await archive(db,ownerId,runId,asOf),selected=slice.selected.find(row=>row.isin===isin);
 const ledgers=await db.$queryRaw<{evidence:PaperLedger}[]>`SELECT "evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("evidence"->'events') e WHERE (e->>'recordedAt')::timestamptz>${utcInstant(asOf)}) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("evidence"->'corporateActions','[]'::jsonb)) a WHERE (a->>'recordedAt')::timestamptz>${utcInstant(asOf)}) ORDER BY "sequence" DESC LIMIT 1`;
 const fills=ledgers[0]?.evidence.events.filter(e=>e.kind==='FILL'&&e.isin===isin&&utcInstant(e.recordedAt)<=utcInstant(asOf))??[];
 return {...metadata(runId,stored),asOf,session:exchangeDate(asOf),isin,listingId:selected?.listingId??null,state:selected?.adjustment?.state??'UNKNOWN',adjustmentRevision:selected?.adjustment?.revision??null,bars:selected?.adjustment?.bars??[],fills,ledgerRevision:ledgers[0]?.evidence.revision??null,reasons:[...slice.reasons,...(!selected?['INSTRUMENT_NOT_IN_HISTORICAL_UNIVERSE']:[]),...(!ledgers[0]?['PAPER_LEDGER_NOT_FOUND']:[])],performanceVerified:false};
}
