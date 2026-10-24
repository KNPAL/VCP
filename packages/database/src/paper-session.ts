import {attemptPaperEntry,readPaperLedger,type HistoricalEntryInput,type OpeningExitInput} from '@vcp/backtest';
import {configurationHash} from '@vcp/strategy';
import {utcInstant,exchangeDate} from '@vcp/domain';
import {verifiedCalendar} from '@vcp/market-data';
import {paperTransaction,type PaperDatabase} from './paper-transaction.js';
import {loadPaperLedger,applyPaperCorporateActions,applyHistoricalDecisionToPaper} from './paper-ledger.js';
import {persistPaperDailyExit,persistPaperOpeningExit,persistPaperProtection,paperPosition} from './paper-protection.js';
import {persistHistoricalEntry} from './historical-entry.js';
import type {StoredHistoricalSnapshot} from './backtest-snapshots.js';

export interface PaperSessionInput {
 session:string;asOf:string;sourceReference:string;
 markets:Record<string,{opening:OpeningExitInput['opening'];liquidity:OpeningExitInput['liquidity']}>;
 /** Candidate order is explicit and pinned, since competition for capital affects fills. */
 entries:readonly {replayEventId:string;input:HistoricalEntryInput}[];
}
export async function runPaperSession(db:PaperDatabase,ownerId:string,runId:string,input:PaperSessionInput){
 input=structuredClone(input);
 const requestHash=configurationHash(input),id=configurationHash({runId,session:input.session});
 return paperTransaction(db,async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const prior=await tx.$queryRaw<{requestHash:string;evidence:Record<string,unknown>}[]>`SELECT "requestHash","evidence" FROM "PaperSessionResult" WHERE "id"=${id} AND "ownerId"=${ownerId}::uuid`;
  if(prior[0]){if(prior[0].requestHash!==requestHash)throw new Error('PAPER_SESSION_RETRY_CONFLICT');return prior[0].evidence}
  const archives=await tx.$queryRaw<{evidence:StoredHistoricalSnapshot}[]>`SELECT s."evidence" FROM "HistoricalReplayRun" r JOIN "HistoricalReplaySnapshot" s ON s."id"=r."snapshotId" WHERE r."id"=${runId} AND r."ownerId"=${ownerId}::uuid`;
  const snapshot=archives[0]?.evidence.snapshot;if(!snapshot)throw new Error('REPLAY_RUN_NOT_FOUND');
  const pinned=snapshot.inputs,day=pinned.calendar.find(day=>day.date===input.session);
  if(!input.sourceReference||!day?.opensAt||!day.finalizedAt||day.kind==='HOLIDAY'||exchangeDate(input.asOf)!==input.session||utcInstant(input.asOf)<utcInstant(day.finalizedAt)||utcInstant(input.asOf)>utcInstant(pinned.knownAt)||verifiedCalendar(pinned.calendar,input.session,input.session,input.asOf).state!=='KNOWN')throw new Error('PAPER_SESSION_UNVERIFIED');
  if(new Set(input.entries.map(row=>row.input.event.id)).size!==input.entries.length)throw new Error('DUPLICATE_PAPER_CANDIDATE');
  for(const candidate of input.entries)if(utcInstant(candidate.input.now).valueOf()!==utcInstant(day.opensAt).valueOf())throw new Error('PAPER_ENTRY_NOT_AT_SESSION_OPEN');
  let ledger=await loadPaperLedger(tx,ownerId,runId);
  if(ledger.events.some(event=>utcInstant(event.recordedAt)>utcInstant(day.opensAt!))||ledger.corporateActions?.some(action=>utcInstant(action.recordedAt)>utcInstant(day.opensAt!)))throw new Error('PAPER_SESSION_NOT_CHRONOLOGICAL');
  const last=await tx.$queryRaw<{session:Date}[]>`SELECT "session" FROM "PaperSessionResult" WHERE "runId"=${runId} AND "ownerId"=${ownerId}::uuid ORDER BY "session" DESC LIMIT 1`;
  const previous=last[0]?.session.toISOString().slice(0,10);
  if(previous&&previous>=input.session)throw new Error('PAPER_SESSION_NOT_CHRONOLOGICAL');
  // Empty pre-entry history can be skipped, but a held position must traverse every session.
  const heldAtStart=Object.keys(readPaperLedger(ledger,day.opensAt,pinned.calendar).portfolio.holdings);
  const lastFill=ledger.events.filter(event=>event.kind==='FILL').at(-1);
  const since=previous??(lastFill?exchangeDate(lastFill.recordedAt):null);
  if(heldAtStart.length&&since&&verifiedCalendar(pinned.calendar,since,input.session,day.opensAt).state!=='KNOWN')throw new Error('PAPER_SESSION_CALENDAR_GAP');
  if(heldAtStart.length&&since&&pinned.calendar.some(row=>row.date>since&&row.date<input.session&&row.kind!=='HOLIDAY'))throw new Error('PAPER_SESSION_GAP');
  const initialRevision=ledger.revision;
  ledger=await applyPaperCorporateActions(tx,ownerId,runId,input.session,ledger.revision);
  const openingResults:unknown[]=[],entryResults:unknown[]=[],dailyResults:unknown[]=[],protectionResults:unknown[]=[];
  const holdings=(asOf:string)=>Object.keys(readPaperLedger(ledger,asOf,pinned.calendar).portfolio.holdings).sort();
  for(const isin of holdings(day.opensAt)){
   const market=input.markets[isin],decision=await persistPaperOpeningExit(tx,ownerId,runId,isin,day.opensAt,market?.opening??null,market?.liquidity??'UNKNOWN');
   openingResults.push(decision);
   if(decision.state==='SIMULATED_EXIT'&&'id' in decision)ledger=await applyHistoricalDecisionToPaper(tx,ownerId,runId,'OPENING_EXIT',decision.id,ledger.revision);
  }
  for(const candidate of input.entries){
   const bound=structuredClone(candidate.input);
   for(const mark of bound.portfolio.positions){
    const context=await paperPosition(tx,ownerId,runId,mark.isin,day.opensAt);
    if(context)mark.stop=context.position.activeStop;
   }
   const computed=attemptPaperEntry(ledger,bound,pinned.calendar).decision;
   const decision=await persistHistoricalEntry(tx,ownerId,runId,candidate.replayEventId,computed.assumptions);entryResults.push(decision);
   if(decision.state==='SIMULATED_FILL')ledger=await applyHistoricalDecisionToPaper(tx,ownerId,runId,'ENTRY',decision.id,ledger.revision);
  }
  for(const isin of holdings(input.asOf)){
   const decision=await persistPaperDailyExit(tx,ownerId,runId,isin,input.asOf,input.markets[isin]?.liquidity??'UNKNOWN');dailyResults.push(decision);
   if(decision.state==='SIMULATED_EXIT'&&'id' in decision)ledger=await applyHistoricalDecisionToPaper(tx,ownerId,runId,'EXIT',decision.id,ledger.revision);
  }
  for(const isin of holdings(input.asOf))protectionResults.push(await persistPaperProtection(tx,ownerId,runId,isin,input.asOf));
  const evidence={id,ownerId,runId,session:input.session,asOf:input.asOf,requestHash,input,initialRevision,ledgerRevision:ledger.revision,openingResults,entryResults,dailyResults,protectionResults,source:'PAPER',simulated:true,executable:false,performanceVerified:false};
  await tx.$executeRaw`INSERT INTO "PaperSessionResult" ("id","runId","ownerId","session","requestHash","evidence") VALUES (${id},${runId},${ownerId}::uuid,${new Date(input.session)},${requestHash},${JSON.stringify(evidence)}::jsonb)`;
  return evidence;
 });
}
