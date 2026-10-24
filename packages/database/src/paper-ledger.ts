import {createPaperLedger,appendPaperFill,appendPaperShareAdjustment,attemptPaperEntry,readPaperLedger,type PaperLedger,type HistoricalEntryInput,type HistoricalExitInput} from '@vcp/backtest';
import {configurationHash} from '@vcp/strategy';
import {exchangeDate,utcInstant} from '@vcp/domain';
import {paperTransaction,type PaperDatabase} from './paper-transaction.js';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';
import {canonicalListings} from '@vcp/market-data';
import {paperPosition} from './paper-protection.js';

export async function initializePaperLedger(db:PaperDatabase,ownerId:string,runId:string,initialCapital:string){
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const rows=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
  if(!rows[0])throw new Error('REPLAY_RUN_NOT_FOUND');
  const input=rows[0].evidence.snapshot.inputs,first=input.calendar.filter(day=>day.date>=input.from&&day.date<=input.through&&day.kind!=='HOLIDAY'&&day.verified&&day.source&&day.opensAt).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(!first?.opensAt)throw new Error('PAPER_START_SESSION_UNAVAILABLE');
  const ledger=createPaperLedger(runId,initialCapital,first.opensAt);
  const prior=await tx.$queryRaw<{evidence:PaperLedger}[]>`SELECT "evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "sequence"=0`;
  if(prior[0]){if(configurationHash(prior[0].evidence.events)!==configurationHash(ledger.events))throw new Error('PAPER_CAPITAL_ALREADY_PINNED');return prior[0].evidence}
  await tx.$executeRaw`INSERT INTO "PaperLedgerRevision" ("revision","runId","ownerId","sequence","evidence") VALUES (${ledger.revision},${runId},${ownerId}::uuid,0,${JSON.stringify(ledger)}::jsonb)`;
  return ledger;
 });
}
export async function loadPaperLedger(db:PaperDatabase,ownerId:string,runId:string){
 const rows=await db.$queryRaw<{evidence:PaperLedger}[]>`SELECT "evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "sequence" DESC LIMIT 1`;
 if(!rows[0])throw new Error('PAPER_LEDGER_NOT_FOUND');return rows[0].evidence;
}
export async function applyHistoricalDecisionToPaper(db:PaperDatabase,ownerId:string,runId:string,kind:'ENTRY'|'EXIT'|'OPENING_EXIT',decisionId:string,expectedRevision:string){
 if(kind!=='ENTRY'&&kind!=='EXIT'&&kind!=='OPENING_EXIT')throw new Error('PAPER_DECISION_KIND_INVALID');
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const rows=await tx.$queryRaw<{sequence:number;evidence:PaperLedger}[]>`SELECT "sequence","evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "sequence" DESC LIMIT 1`;
  const current=rows[0];if(!current)throw new Error('PAPER_LEDGER_NOT_FOUND');
  const ledger=current.evidence;
  if(ledger.events.some(event=>event.sourceId===decisionId))return ledger;
  if(ledger.revision!==expectedRevision)throw new Error('PAPER_LEDGER_REVISION_CONFLICT');
  const snapshots=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
  const snapshot=snapshots[0]!.evidence.snapshot;
  let next:PaperLedger;
  if(kind==='ENTRY'){
   const source=await tx.$queryRaw<{evidence:{decisionHash:string;assumptions:HistoricalEntryInput;state:string;quantity:number;price:string;fees:string;decidedAt:string}}[]>`SELECT "evidence" FROM "HistoricalEntryDecision" WHERE "id"=${decisionId} AND "runId"=${runId} AND "ownerId"=${ownerId}::uuid`;
   const record=source[0]?.evidence;if(!record)throw new Error('PAPER_SOURCE_DECISION_NOT_FOUND');
   if(record.state!=='SIMULATED_FILL')throw new Error('PAPER_SOURCE_HAS_NO_FILL');
   const computed=attemptPaperEntry(ledger,record.assumptions,snapshot.inputs.calendar).decision;
   if(computed.id!==record.decisionHash||computed.state!=='SIMULATED_FILL')throw new Error('PAPER_ENTRY_REEVALUATION_REQUIRED');
   next=appendPaperFill(ledger,{id:decisionId,sourceDecisionId:decisionId,expectedLedgerRevision:expectedRevision,isin:record.assumptions.isin,side:'BUY',quantity:record.quantity,price:record.price,fees:record.fees,modeledAt:record.decidedAt,decidedAt:record.decidedAt,simulated:true,executable:false});
  }else{
   type ExitRecord={evidence:{assumptions:HistoricalExitInput;state:string;quantity:number;adjusted?:{quantity:number};decidedAt:string;fill:{price:string;fees:string;modeledAt:string}|null}};
   const source=kind==='OPENING_EXIT'?await tx.$queryRaw<ExitRecord[]>`SELECT "evidence" FROM "PaperOpeningExitDecision" WHERE "id"=${decisionId} AND "runId"=${runId} AND "ownerId"=${ownerId}::uuid`:await tx.$queryRaw<ExitRecord[]>`SELECT "evidence" FROM "HistoricalExitDecision" WHERE "id"=${decisionId} AND "runId"=${runId} AND "ownerId"=${ownerId}::uuid`;
   const record=source[0]?.evidence;if(!record)throw new Error('PAPER_SOURCE_DECISION_NOT_FOUND');
   if(record.state!=='SIMULATED_EXIT'||!record.fill)throw new Error('PAPER_SOURCE_HAS_NO_FILL');
   const input=record.assumptions,isin=[...new Set(snapshot.inputs.instruments.flatMap(row=>row.rows.filter(mapping=>mapping.listingId===input.position.listingId).map(mapping=>mapping.isin)))].find(isin=>canonicalListings(snapshot.inputs.instruments,[isin],input.asOf)[0]?.primary?.listingId===input.position.listingId);
   if(!isin)throw new Error('PAPER_EXIT_IDENTITY_UNKNOWN');
   const context=await paperPosition(tx,ownerId,runId,isin,record.decidedAt);
   if(!context)throw new Error('PAPER_EXIT_POSITION_MISMATCH');
   for(const field of ['id','listingId','quantity','entry','initialStop','activeStop','scaleSession','stopEffectiveAt','partialTaken'] as const)if(context.position[field]!==input.position[field])throw new Error('PAPER_EXIT_POSITION_MISMATCH');
   if(configurationHash(context.scheduledSell)!==configurationHash(input.scheduledSell))throw new Error('PAPER_EXIT_SCHEDULE_MISMATCH');
   const currentPortfolio=readPaperLedger(ledger,record.decidedAt,snapshot.inputs.calendar).portfolio;
   if(currentPortfolio.holdings[isin]!==record.adjusted?.quantity)throw new Error('PAPER_EXIT_POSITION_MISMATCH');
   next=appendPaperFill(ledger,{id:decisionId,sourceDecisionId:decisionId,expectedLedgerRevision:expectedRevision,isin,side:'SELL',quantity:record.quantity,price:record.fill.price,fees:record.fill.fees,modeledAt:record.fill.modeledAt,decidedAt:record.decidedAt,simulated:true,executable:false});
  }
  await tx.$executeRaw`INSERT INTO "PaperLedgerRevision" ("revision","runId","ownerId","sequence","parentRevision","evidence") VALUES (${next.revision},${runId},${ownerId}::uuid,${current.sequence+1},${ledger.revision},${JSON.stringify(next)}::jsonb)`;
  return next;
 });
}
/** Apply verified entitlements before session fills, retaining original cash flows and exact lot cost. */
export async function applyPaperCorporateActions(db:PaperDatabase,ownerId:string,runId:string,session:string,expectedRevision:string){
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const rows=await tx.$queryRaw<{sequence:number;evidence:PaperLedger}[]>`SELECT "sequence","evidence" FROM "PaperLedgerRevision" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "sequence" DESC LIMIT 1`;
  const current=rows[0];if(!current)throw new Error('PAPER_LEDGER_NOT_FOUND');
  const snapshots=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
  const pinned=snapshots[0]!.evidence.snapshot.inputs,day=pinned.calendar.find(day=>day.date===session);
  if(!day?.opensAt||day.kind==='HOLIDAY'||!day.verified||!day.source||utcInstant(day.knownAt)>utcInstant(day.opensAt)||utcInstant(day.opensAt)>utcInstant(pinned.knownAt))throw new Error('PAPER_ACTION_SESSION_UNKNOWN');
  let ledger=current.evidence;const portfolio=readPaperLedger(ledger,day.opensAt,pinned.calendar).portfolio;
  for(const isin of Object.keys(portfolio.holdings).sort()){
   const mapping=canonicalListings(pinned.instruments,[isin],day.opensAt)[0]?.primary;if(!mapping)throw new Error('PAPER_ACTION_MAPPING_UNKNOWN');
   const source=pinned.actions.filter(row=>row.listingId===mapping.listingId&&new Date(row.knownAt)<=new Date(day.opensAt!)).sort((a,b)=>new Date(b.knownAt).valueOf()-new Date(a.knownAt).valueOf()||a.id.localeCompare(b.id))[0];
   const oldest=portfolio.lots.filter(lot=>lot.isin===isin&&lot.remainingQty>0).map(lot=>lot.occurredAt).sort()[0]!;
   if(!source?.verified||!source.sourceReference||source.coverageFrom>exchangeDate(oldest)||source.coverageThrough<session)throw new Error('PAPER_ACTION_COVERAGE_UNKNOWN');
   for(const action of [...source.actions].filter(action=>new Date(action.effectiveAt)>new Date(oldest)&&new Date(action.effectiveAt)<=new Date(day.opensAt!)).sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt)||a.id.localeCompare(b.id))){
    if(!action.verified||!action.sourceReference||new Date(action.knownAt)>new Date(source.knownAt)||action.listingId!==mapping.listingId||!['SPLIT','BONUS'].includes(action.kind)||!/^\d+$/.test(action.sharesAfter)||!/^\d+$/.test(action.sharesBefore)||BigInt(action.sharesAfter)<=0n||BigInt(action.sharesBefore)<=0n||(action.kind==='BONUS'&&BigInt(action.sharesAfter)<=BigInt(action.sharesBefore)))throw new Error('PAPER_ACTION_UNVERIFIED');
    const id=mapping.listingId+':'+action.id,prior=ledger.corporateActions?.find(row=>row.id===id);
    if(prior){if(prior.sharesAfter!==action.sharesAfter||prior.sharesBefore!==action.sharesBefore||prior.occurredAt!==action.effectiveAt)throw new Error('PAPER_ACTION_REVISION_CONFLICT');continue}
    ledger=appendPaperShareAdjustment(ledger,{id,isin,sharesAfter:action.sharesAfter,sharesBefore:action.sharesBefore,occurredAt:action.effectiveAt,recordedAt:day.opensAt,sourceId:source.id},ledger.revision);
   }
  }
  if(ledger.revision===current.evidence.revision)return ledger;
  if(current.evidence.revision!==expectedRevision)throw new Error('PAPER_LEDGER_REVISION_CONFLICT');
  await tx.$executeRaw`INSERT INTO "PaperLedgerRevision" ("revision","runId","ownerId","sequence","parentRevision","evidence") VALUES (${ledger.revision},${runId},${ownerId}::uuid,${current.sequence+1},${current.evidence.revision},${JSON.stringify(ledger)}::jsonb)`;
  return ledger;
 });
}
