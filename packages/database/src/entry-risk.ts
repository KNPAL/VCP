import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {parseFixed,utcInstant} from '@vcp/domain';
import {sizeEntry,sizeTopUp,entrySizingGates} from '@vcp/portfolio';
import {evaluateEntry,structuralStop,type MarketEvent} from '@vcp/strategy';
import {assessHeldQuote,canonicalListings,sectorAt,verifiedCalendar,type InstrumentSnapshot,type CalendarDay,type SectorMapping} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readPortfolioRiskTransaction,type PortfolioQuotes} from './portfolio-risk.js';
import {actionScale} from './protective-stops.js';
import {readCurrentRegime} from './current-regime.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type EntryRiskRequest={marketEventId:string;snapshotId:string;estimatedFees:string;topUpQuantity?:number};
/** User selects an existing event and observation. No user-supplied quote or PASS gate is accepted. */
export async function recordEntryRisk(db:PrismaClient,ownerId:string,key:string,request:EntryRiskRequest){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key)||!/^[a-f0-9]{64}$/.test(request.marketEventId)||!/^[a-f0-9]{64}$/.test(request.snapshotId)||parseFixed(request.estimatedFees)<0n)throw new Error('INVALID_ENTRY_PLAN');
 if(request.topUpQuantity!==undefined&&(!Number.isSafeInteger(request.topUpQuantity)||request.topUpQuantity<=0))throw new Error('INVALID_ENTRY_PLAN');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  const identity='entry-risk:'+key,requestHash=hash(request),prior=await tx.idempotencyRecord.findUnique({where:{ownerId_key:{ownerId,key:identity}}});
  if(prior){if(prior.requestHash!==requestHash)throw new Error('STALE_CONFLICT');return prior.response}
  const events=await tx.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${request.marketEventId}`;
  if(!events[0])throw new Error('MARKET_EVENT_UNAVAILABLE');
  const event=events[0].evidence;
  const snapshots=await tx.$queryRaw<{evidence:{quotes:PortfolioQuotes}}[]>`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "id"=${request.snapshotId} AND "ownerId"=${ownerId}::uuid`;
  if(!snapshots[0])throw new Error('STALE_CONFLICT');
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const calendars=await tx.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const sectors=await tx.$queryRaw<{id:string;evidence:{mappings:SectorMapping[]}}[]>`SELECT "id","evidence" FROM "SectorSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const structures=await tx.$queryRaw<{evidence:{input:{scaleRevision:string}}}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${event.listingId}::uuid AND "evidence"->'breakout'->'event'->>'id'=${event.id} LIMIT 1`;
  const mapping=mappings[0]?.evidence??null,isin=mapping?.rows.find(r=>r.listingId===event.listingId)?.isin??null;
  const before=new Date().toISOString(),listing=isin?canonicalListings(mapping?[mapping]:[],[isin],before)[0]?.primary:null;
  const scale=listing?await actionScale(tx,listing.listingId,before):null;
  const regimeEvidence=await readCurrentRegime(tx,before);
  // Last read is the owner-locked, journal-bound valuation; it checks quote deadlines again.
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  if(risk.snapshotId!==request.snapshotId||risk.reasons.includes('JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT')||Date.parse(risk.validUntil)<=Date.parse(risk.asOf))throw new Error('STALE_CONFLICT');
  const regime=Date.parse(regimeEvidence.validUntil)>Date.parse(risk.asOf)?regimeEvidence.regime:'UNKNOWN';
  const quote=isin?snapshots[0].evidence.quotes[isin]:null;
  const feed=isin?assessHeldQuote(isin,risk.asOf,calendars[0]?.evidence??null,mapping,quote?{state:'KNOWN',quote}:{state:'UNKNOWN',reason:'QUOTE_UNAVAILABLE'}):null;
  const sourceMatches=!!scale&&scale===structures[0]?.evidence.input.scaleRevision;
  const currentQuote=feed?.state==='FEED_FRESH'&&listing?.listingId===event.listingId&&sourceMatches?quote:null;
  const days=calendars[0]?.evidence;
  let calendar:{date:string;opensAt:string;closesAt:string}[]|null=null;
  try{if(days?.length&&verifiedCalendar(days,event.session,days.map(d=>d.date).sort().at(-1)!,risk.asOf).state==='KNOWN')calendar=days.filter(d=>d.date>=event.session&&d.verified&&utcInstant(d.knownAt)<=utcInstant(risk.asOf)&&d.kind!=='HOLIDAY'&&d.opensAt&&d.closesAt).sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({date:d.date,opensAt:d.opensAt!,closesAt:d.closesAt!}))}catch{calendar=null}
  const stop=request.topUpQuantity!==undefined?risk.valuation.positions.find(p=>p.isin===isin)?.stop??null:currentQuote&&listing?structuralStop(event.lastLow,listing.tick,currentQuote.ltp).stop:null;
  const sector=isin?sectorAt(sectors[0]?.evidence.mappings??[],isin,risk.asOf).sector:null;
  const sizingInput=currentQuote&&stop&&parseFixed(stop)>0n&&isin&&listing?{portfolio:risk.valuation,isin,sector,entry:currentQuote.ltp,stop,regime,lotSize:listing.lot,estimatedFees:request.estimatedFees,lossStreakPass:risk.lossStreak.pass}:null;
  const sizing=sizingInput?(request.topUpQuantity===undefined?sizeEntry(sizingInput):sizeTopUp({...sizingInput,lots:risk.journal.lots,requestedQuantity:request.topUpQuantity})):null;
  const riskGates=entrySizingGates(sizing,listing?.lot??1,risk.lossStreak.pass);
  const decision=evaluateEntry({event,now:risk.asOf,calendar,continuousMarket:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',
   quote:currentQuote?{price:currentQuote.ltp,at:currentQuote.sourceAt}:null,
   heartbeatAt:null,brokerConnected:'UNKNOWN',sessionValid:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',tokenValid:listing?.listingId===event.listingId?'PASS':'UNKNOWN',brokerSettled:'UNKNOWN',
   gates:{G04:regime==='UNKNOWN'?'UNKNOWN':'PASS',G05:sector?'PASS':'UNKNOWN',G06:'UNKNOWN',G08:risk.reconciliation.state==='RECONCILED_AS_OF'?'PASS':'UNKNOWN'},riskGates,regime,tick:listing?.tick??'0.05'});
  const reasons=[...new Set([...risk.reasons,...decision.reasons,...(sizing?.reasons??['CAP_INPUTS_UNAVAILABLE']),...(!sourceMatches?['ENTRY_PRICE_SCALE_UNVERIFIED']:[]),...regimeEvidence.reasons,...(regime==='UNKNOWN'?['REGIME_EVIDENCE_REQUIRED']:[])])];
  const expiresAt=new Date(Math.min(Date.parse(decision.expiresAt),Date.parse(risk.validUntil),...(regime!=='UNKNOWN'?[Date.parse(regimeEvidence.validUntil)]:[]),...(currentQuote?[Date.parse(currentQuote.validUntil)]:[]))).toISOString();
  const id=hash([ownerId,key,requestHash,risk.journalHash,risk.asOf]),evidence={id,ownerId,request,marketEventId:event.id,snapshotId:risk.snapshotId,journalHash:risk.journalHash,asOf:risk.asOf,expiresAt,isin,state:'BUY_BLOCKED',reasons,
   quantity:0,entry:currentQuote?.ltp??null,stop,proposalType:request.topUpQuantity===undefined?'ENTRY':'MANUAL_TOPUP',automatedAdd:false,estimatedFees:request.estimatedFees,riskBudget:sizing?.riskBudget??null,caps:sizing?.caps??null,
   readinessEvidence:{sectorId:sectors[0]?.id??null,sector,reconciliation:risk.reconciliation},regimeEvidence,valuation:risk.valuation,lossStreak:risk.lossStreak,cashAllocationRevision:risk.cashAllocationRevision,entryEvidence:decision,sizing,executable:false};
  await tx.$executeRaw`INSERT INTO "EntryRiskPlan" ("id","ownerId","marketEventId","asOf","expiresAt","journalHash","evidence") VALUES (${id},${ownerId}::uuid,${event.id},${new Date(risk.asOf)},${new Date(expiresAt)},${risk.journalHash},${canonical(evidence)}::jsonb)`;
  const response=JSON.parse(canonical(evidence)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 },{timeout:15000});
}
export async function readEntryRisk(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  const regime=await readCurrentRegime(tx,risk.asOf);
  const plans=await tx.$queryRaw<{evidence:{id:string;journalHash:string;expiresAt:string;cashAllocationRevision?:string;readinessEvidence?:{sectorId:string|null};regimeEvidence?:{revision:string|null}}}[]>`SELECT "evidence" FROM "EntryRiskPlan" WHERE "ownerId"=${ownerId}::uuid ORDER BY "asOf" DESC,"id" LIMIT 50`;
  return {items:plans.map(r=>{
   const reasons=[...(r.evidence.journalHash!==risk.journalHash?['JOURNAL_CHANGED_SINCE_PLAN']:[]),...(Date.parse(r.evidence.expiresAt)<=Date.now()?['PLAN_EXPIRED']:[]),...(r.evidence.cashAllocationRevision!==risk.cashAllocationRevision?['CASH_ALLOCATION_CHANGED_SINCE_PLAN']:[]),...(regime.regime==='UNKNOWN'||r.evidence.regimeEvidence?.revision!==regime.revision?['REGIME_CHANGED_OR_UNAVAILABLE']:[]),...(r.evidence.readinessEvidence?.sectorId!==risk.sources.sectorId?['SECTOR_EVIDENCE_CHANGED']:[]),...risk.reasons];
   return {evidence:r.evidence,current:reasons.length===0,validityReasons:[...new Set(reasons)],executable:false};
  }),asOf:risk.asOf,executable:false};
 },{timeout:15000});
}




