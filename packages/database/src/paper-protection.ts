import type {Prisma} from '@prisma/client';
import {paperTransaction,type PaperDatabase} from './paper-transaction.js';
import {paperEodProtection,readPaperLedger,simulateOpeningExit,historicalSlice,type OpeningExitInput,type PaperLedger,type HistoricalEntryInput,type HistoricalExitInput} from '@vcp/backtest';
import {configurationHash} from '@vcp/strategy';
import {canonicalListings} from '@vcp/market-data';
import {exchangeDate,parseFixed,formatFixed,utcInstant} from '@vcp/domain';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
import {persistHistoricalExit} from './historical-exit.js';
type Protection=ReturnType<typeof paperEodProtection>;
interface Plan {id:string;runId:string;ownerId:string;episodeId:string;isin:string;session:string;sourceAt:string;occurredAt:string;decidedAt:string;effectiveAt:string;ledgerRevision:string;strategyRevision:string;dataRevision:string;result:Protection}
export async function paperPosition(tx:Prisma.TransactionClient,ownerId:string,runId:string,isin:string,asOf:string){
  const ledgers=await tx.$queryRaw<{evidence:PaperLedger}[]>`SELECT "evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "sequence" DESC LIMIT 1`;
  const ledger=ledgers[0]?.evidence;if(!ledger)throw new Error('PAPER_LEDGER_NOT_FOUND');
  const archives=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
  const snapshot=archives[0]!.evidence.snapshot,pinned=snapshot.inputs;
  if(utcInstant(asOf)>utcInstant(pinned.knownAt)||exchangeDate(asOf)<pinned.from||exchangeDate(asOf)>pinned.through)throw new Error('PAPER_PROTECTION_OUTSIDE_SNAPSHOT');
  if(ledger.events.some(event=>utcInstant(event.recordedAt)>utcInstant(asOf))||ledger.corporateActions?.some(action=>utcInstant(action.recordedAt)>utcInstant(asOf)))throw new Error('PAPER_PROTECTION_NOT_CHRONOLOGICAL');
  const state=readPaperLedger(ledger,asOf,pinned.calendar),episode=state.cooldown.episodes.find(episode=>episode.isin===isin&&episode.closedAt===null);
  if(!episode)return null;
  const session=exchangeDate(asOf);
  const first=ledger.events.find(event=>event.id===episode.id);if(!first||first.kind!=='FILL'||first.side!=='BUY')throw new Error('PAPER_ENTRY_MISSING');
  const entries=await tx.$queryRaw<{evidence:{price:string;stop:string;assumptions:HistoricalEntryInput}}[]>`SELECT "evidence" FROM "HistoricalEntryDecision" WHERE "id"=${first.sourceId} AND "runId"=${runId} AND "ownerId"=${ownerId}::uuid`;
  const entry=entries[0]?.evidence;if(!entry)throw new Error('PAPER_ENTRY_SOURCE_MISSING');
  const mapping=canonicalListings(pinned.instruments,[isin],asOf)[0]?.primary,day=pinned.calendar.find(day=>day.date===session);
  if(!mapping||mapping.listingId!==entry.assumptions.event.listingId||!day?.opensAt)throw new Error('PAPER_POSITION_MAPPING_UNKNOWN');
  const source=pinned.actions.filter(row=>row.listingId===mapping.listingId&&new Date(row.knownAt)<=new Date(asOf)).sort((a,b)=>new Date(b.knownAt).valueOf()-new Date(a.knownAt).valueOf()||a.id.localeCompare(b.id))[0];
  if(!source?.verified||!source.sourceReference||source.coverageFrom>exchangeDate(first.occurredAt)||source.coverageThrough<session)throw new Error('PAPER_ACTION_COVERAGE_UNKNOWN');
  const actions=ledger.corporateActions?.filter(action=>action.isin===isin&&new Date(action.recordedAt)<=new Date(asOf)&&new Date(action.occurredAt)>new Date(first.occurredAt))??[];
  for(const action of source.actions.filter(action=>new Date(action.effectiveAt)>new Date(first.occurredAt)&&exchangeDate(action.effectiveAt)<=session)){
   if(!actions.some(row=>row.id===mapping.listingId+':'+action.id&&row.sharesAfter===action.sharesAfter&&row.sharesBefore===action.sharesBefore))throw new Error('PAPER_CORPORATE_ACTIONS_PENDING');
  }
  const tick=parseFixed(mapping.tick),scaled=(value:string,since:string,isStop=false)=>{let n=parseFixed(value),d=1n;for(const action of actions)if(exchangeDate(action.occurredAt)>since){n*=BigInt(action.sharesBefore);d*=BigInt(action.sharesAfter)}const valueUnits=n/d;return formatFixed(isStop?valueUnits/tick*tick:valueUnits)};
  const plans=await tx.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "PaperProtectionPlan" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid AND "episodeId"=${episode.id}::uuid AND "effectiveAt"<=${new Date(day.opensAt)} AND "decidedAt"<${new Date(day.opensAt)} ORDER BY "session" DESC`;
  const active=plans.map(row=>row.evidence).find(plan=>plan.result.trail?.nextStop),basis=exchangeDate(first.occurredAt);
  const exits=await tx.$queryRaw<{id:string;evidence:{kind?:string}}[]>`SELECT "id","evidence" FROM "HistoricalExitDecision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid`;
  const partialTaken=ledger.events.some(event=>event.kind==='FILL'&&episode.fillIds.includes(event.id)&&event.side==='SELL'&&exits.some(exit=>exit.id===event.sourceId&&exit.evidence.kind==='PARTIAL_2R'));
  const position={id:episode.id,listingId:mapping.listingId,quantity:episode.quantity,entry:scaled(entry.price,basis),initialStop:scaled(entry.stop,basis,true),activeStop:active?scaled(active.result.trail!.nextStop!,active.session,true):scaled(entry.stop,basis,true),scaleSession:session,stopEffectiveAt:active?.effectiveAt??first.occurredAt,partialTaken,buySession:basis,pivot:scaled(entry.assumptions.event.pivot,basis),trailActivated:active?.result.trail?.activated??false};
  const pending=[...plans].reverse().map(row=>row.evidence).find(plan=>plan.result.scheduledSell);
  return {snapshot,ledger,episode,session,position,mapping,day,scheduledSell:pending?{id:pending.id,knownAt:pending.decidedAt,quantity:episode.quantity}:null};
}
export async function persistPaperProtection(db:PaperDatabase,ownerId:string,runId:string,isin:string,asOf:string){
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const context=await paperPosition(tx,ownerId,runId,isin,asOf);
  if(!context)return {state:'NO_OPEN_PAPER_POSITION',executable:false};
  const {snapshot,ledger,episode,session,position}=context,id=configurationHash({runId,episodeId:episode.id,session});
  const prior=await tx.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "PaperProtectionPlan" WHERE "id"=${id}`;
  if(prior[0]){if(prior[0].evidence.ledgerRevision!==ledger.revision||utcInstant(prior[0].evidence.decidedAt).valueOf()!==utcInstant(asOf).valueOf())throw new Error('PAPER_PROTECTION_RETRY_CONFLICT');return prior[0].evidence}
  const result=paperEodProtection(snapshot,position,asOf);
  const effectiveAt=result.scheduledSell?.effectiveAt??result.trail?.effectiveAt??asOf;
  const evidence:Plan={id,runId,ownerId,episodeId:episode.id,isin,session,sourceAt:asOf,occurredAt:asOf,decidedAt:asOf,effectiveAt,ledgerRevision:ledger.revision,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,result};
  await tx.$executeRaw`INSERT INTO "PaperProtectionPlan" ("id","runId","ownerId","episodeId","isin","session","sourceAt","occurredAt","decidedAt","effectiveAt","evidence") VALUES (${id},${runId},${ownerId}::uuid,${episode.id}::uuid,${isin},${new Date(session)},${new Date(asOf)},${new Date(asOf)},${new Date(asOf)},${new Date(effectiveAt)},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
/** Derive quantities, stops and pending sells from durable paper evidence, never caller-supplied positions. */
export async function persistPaperDailyExit(db:PaperDatabase,ownerId:string,runId:string,isin:string,asOf:string,liquidity:HistoricalExitInput['liquidity']){
 const context=await paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  return paperPosition(tx,ownerId,runId,isin,asOf);
 });
 if(!context)return {state:'NO_OPEN_PAPER_POSITION',executable:false};
 const {snapshot,position,session,day,mapping,scheduledSell,ledger}=context,pinned=snapshot.inputs;
 const bar=pinned.raw.filter(row=>row.listingId===position.listingId&&row.session===session&&utcInstant(row.receivedAt)<=utcInstant(asOf)&&row.finalizedAt&&utcInstant(row.finalizedAt)<=utcInstant(asOf)).sort((a,b)=>b.revision-a.revision)[0];
 if(!bar)return {state:'DAILY_BAR_UNAVAILABLE',executable:false};
 const actions=pinned.actions.filter(row=>row.listingId===position.listingId&&utcInstant(row.knownAt)<=utcInstant(day.opensAt!)).sort((a,b)=>utcInstant(b.knownAt).valueOf()-utcInstant(a.knownAt).valueOf()||a.id.localeCompare(b.id))[0]??null;
 const decision=await persistHistoricalExit(db,ownerId,runId,{snapshotId:snapshot.id,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,position,bar,calendar:day,actions,tick:mapping.tick,lotSize:mapping.lot,liquidity,scheduledSell,fees:pinned.fees,bias:null,asOf});
 return {...decision,expectedLedgerRevision:ledger.revision};
}
export async function persistPaperOpeningExit(db:PaperDatabase,ownerId:string,runId:string,isin:string,asOf:string,opening:OpeningExitInput['opening'],liquidity:OpeningExitInput['liquidity']){
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const context=await paperPosition(tx,ownerId,runId,isin,asOf);
  if(!context)return {state:'NO_OPEN_PAPER_POSITION',executable:false};
  const {snapshot,position,session,day,mapping,scheduledSell,ledger}=context;
  const slice=historicalSlice(snapshot,asOf);
  const input:OpeningExitInput={snapshotId:snapshot.id,strategyRevision:snapshot.strategyHash,dataRevision:snapshot.dataRevision,position,buySession:position.buySession,calendar:day,tick:mapping.tick,lotSize:mapping.lot,liquidity,scheduledSell,fees:snapshot.inputs.fees,bias:slice.bias,asOf,opening};
  const decision=simulateOpeningExit(input),id=configurationHash({runId,positionId:position.id,session,phase:'OPENING'}),evidence={...decision,id,decisionHash:decision.id,runId,ownerId,expectedLedgerRevision:ledger.revision,limitations:slice.reasons};
  const prior=await tx.$queryRaw<{evidence:typeof evidence}[]>`SELECT "evidence" FROM "PaperOpeningExitDecision" WHERE "id"=${id}`;
  if(prior[0]){if(prior[0].evidence.decisionHash!==decision.id||prior[0].evidence.expectedLedgerRevision!==ledger.revision)throw new Error('PAPER_OPENING_RETRY_CONFLICT');return prior[0].evidence}
  await tx.$executeRaw`INSERT INTO "PaperOpeningExitDecision" ("id","runId","ownerId","positionId","session","decidedAt","evidence") VALUES (${id},${runId},${ownerId}::uuid,${position.id}::uuid,${new Date(session)},${new Date(asOf)},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
