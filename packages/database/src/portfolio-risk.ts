import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {openEpisode,projectPortfolio,valuePortfolio,type PortfolioEvent,type BrokerStatement,reconcileStatement} from '@vcp/portfolio';
import {assessHeldQuote,canonicalListings,sectorAt,type CalendarDay,type InstrumentSnapshot,type SectorMapping,type NormalizedQuote} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {actionScale,type InitialStop} from './protective-stops.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type PortfolioQuotes=Record<string,NormalizedQuote&{validUntil:string}>;
type Reconciliation={id:string;journalHash:string;statement:BrokerStatement;result:ReturnType<typeof reconcileStatement>};
type SavedRisk={id:string;asOf:string;validUntil:string;journalHash:string;quotes:PortfolioQuotes};

/** Internal worker input only. Public callers cannot submit financial evidence or gate results. */
async function calculate(tx:Prisma.TransactionClient,ownerId:string,quotes:PortfolioQuotes,extraReasons:string[]=[],snapshotDeadline?:string){
 const journal=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
 const events=journal.map(r=>r.evidence),journalHash=hash(events);
 const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
 const sectors=await tx.$queryRaw<{id:string;evidence:{mappings:SectorMapping[]}}[]>`SELECT "id","evidence" FROM "SectorSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const comparisons=await tx.$queryRaw<{evidence:Reconciliation}[]>`SELECT "evidence" FROM "PortfolioReconciliation" WHERE "ownerId"=${ownerId}::uuid ORDER BY "decidedAt" DESC,"id" DESC LIMIT 1`;
 const stops=await tx.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid`;
 const at=new Date().toISOString(),journalView=projectPortfolio(events,at),mapping=mappings[0]?.evidence??null;
 const comparison=comparisons[0]?.evidence??null,matched=!!comparison&&comparison.journalHash===journalHash&&comparison.result.state==='RECONCILED_AS_OF';
 const reconciliation={state:matched?'RECONCILED_AS_OF':'PORTFOLIO_UNRECONCILED',reasons:!comparison?['RECONCILIATION_REQUIRED']:comparison.journalHash!==journalHash?['JOURNAL_CHANGED_SINCE_RECONCILIATION']:comparison.result.reasons,latest:comparison,executable:false};
 const prepared=await Promise.all(Object.entries(journalView.holdings).map(async ([isin,quantity])=>{
  const episode=openEpisode(events,isin,at)!,record=stops.find(r=>r.evidence.isin===isin&&r.evidence.episodeId===episode.identity)?.evidence;
  const listing=canonicalListings(mapping?[mapping]:[],[isin],at)[0]?.primary;
  const currentStop=record?.fillId===episode.first.id&&record.stop?.listingId===listing?.listingId&&record.stop&&await actionScale(tx,record.stop.listingId,at)===record.stop.scaleRevision?record.stop:null;
  return {isin,quantity,sector:sectorAt(sectors[0]?.evidence.mappings??[],isin,at).sector,stop:currentStop?.activeStop??null};
 }));
 // Recheck quote deadlines after all reads and any lock wait.
 const asOf=new Date().toISOString();
 if(snapshotDeadline&&Date.parse(snapshotDeadline)<=Date.parse(asOf)){quotes={};extraReasons.push('RISK_SNAPSHOT_EXPIRED')}
 const holdings=prepared.map(p=>{const quote=quotes[p.isin],assessment=assessHeldQuote(p.isin,asOf,calendars[0]?.evidence??null,mapping,quote?{state:'KNOWN',quote}:{state:'UNKNOWN',reason:'QUOTE_UNAVAILABLE'});
  return {...p,price:quote?.ltp??null,quoteAt:quote?.sourceAt??null,verified:assessment.state==='FEED_FRESH',quoteReason:assessment.reason};
 });
 const valuation=valuePortfolio({cash:journalView.cash,cashVerified:journalView.state==='KNOWN',reconciled:matched,holdings,asOf});
 const validUntil=new Date(Math.min(Date.parse(asOf)+30000,...(snapshotDeadline?[Date.parse(snapshotDeadline)]:[]),...holdings.filter(h=>h.verified).flatMap(h=>[Date.parse(quotes[h.isin]!.validUntil),Date.parse(quotes[h.isin]!.sourceAt)+60000]))).toISOString();
 return {journal:{...journalView,events:events.filter(e=>e.recordedAt<=at)},journalHash,valuation,reconciliation,asOf,validUntil,
  sources:{mappingId:mapping?.id??null,calendarId:calendars[0]?.id??null,sectorId:sectors[0]?.id??null,stopIds:stops.map(r=>r.evidence.id)},
  reasons:[...new Set([...journalView.reasons,...valuation.reasons,...reconciliation.reasons,...extraReasons])],
  // Entry sizing must be tied to a specific server-validated candidate and regime.
  plan:{state:'BUY_BLOCKED',reasons:['ENTRY_PLAN_REQUIRED','REGIME_EVIDENCE_REQUIRED','LOSS_STREAK_EVIDENCE_REQUIRED'],riskBudget:null,caps:null,quantity:0},
  executable:false};
}
export async function recordPortfolioRisk(db:PrismaClient,ownerId:string,quotes:PortfolioQuotes){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const result=await calculate(tx,ownerId,quotes),id=hash([ownerId,result,quotes]),evidence={...result,id,quotes};
  await tx.$executeRaw`INSERT INTO "PortfolioRiskSnapshot" ("id","ownerId","asOf","journalHash","evidence") VALUES (${id},${ownerId}::uuid,${new Date(result.asOf)},${result.journalHash},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
  return evidence;
 },{timeout:15000});
}
export async function readPortfolioRisk(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const snapshots=await tx.$queryRaw<{evidence:SavedRisk}[]>`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "ownerId"=${ownerId}::uuid ORDER BY "asOf" DESC,"id" LIMIT 1`;
  const saved=snapshots[0]?.evidence,rows=await tx.$queryRaw<{evidence:PortfolioEvent}[]>`SELECT "evidence" FROM "PortfolioJournal" WHERE "ownerId"=${ownerId}::uuid ORDER BY "sequence"`;
  const changed=!!saved&&saved.journalHash!==hash(rows.map(r=>r.evidence)),expired=!!saved&&Date.parse(saved.validUntil)<=Date.now();
  const reasons=!saved?['RISK_SNAPSHOT_UNAVAILABLE']:changed?['JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT']:expired?['RISK_SNAPSHOT_EXPIRED']:[];
  const result=await calculate(tx,ownerId,reasons.length?{}:saved!.quotes,reasons,saved?.validUntil);
  return {...result,snapshotId:saved?.id??null,snapshotAsOf:saved?.asOf??null,snapshotValidUntil:saved?.validUntil??null};
 },{timeout:15000});
}
