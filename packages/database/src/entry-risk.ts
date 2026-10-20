import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {parseFixed,utcInstant} from '@vcp/domain';
import {sizeEntry} from '@vcp/portfolio';
import {evaluateEntry,type MarketEvent} from '@vcp/strategy';
import {assessHeldQuote,canonicalListings,sectorAt,verifiedCalendar,type InstrumentSnapshot,type CalendarDay,type SectorMapping} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readPortfolioRiskTransaction,type PortfolioQuotes} from './portfolio-risk.js';
import {actionScale} from './protective-stops.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type EntryRiskRequest={marketEventId:string;snapshotId:string;estimatedFees:string};
/** User selects an existing event and observation. No user-supplied quote or PASS gate is accepted. */
export async function recordEntryRisk(db:PrismaClient,ownerId:string,key:string,request:EntryRiskRequest){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key)||!/^[a-f0-9]{64}$/.test(request.marketEventId)||!/^[a-f0-9]{64}$/.test(request.snapshotId)||parseFixed(request.estimatedFees)<0n)throw new Error('INVALID_ENTRY_PLAN');
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
  const sectors=await tx.$queryRaw<{evidence:{mappings:SectorMapping[]}}[]>`SELECT "evidence" FROM "SectorSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const structures=await tx.$queryRaw<{evidence:{input:{scaleRevision:string}}}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${event.listingId}::uuid AND "evidence"->'breakout'->'event'->>'id'=${event.id} LIMIT 1`;
  const mapping=mappings[0]?.evidence??null,isin=mapping?.rows.find(r=>r.listingId===event.listingId)?.isin??null;
  const before=new Date().toISOString(),listing=isin?canonicalListings(mapping?[mapping]:[],[isin],before)[0]?.primary:null;
  const scale=listing?await actionScale(tx,listing.listingId,before):null;
  // Last read is the owner-locked, journal-bound valuation; it checks quote deadlines again.
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  if(risk.snapshotId!==request.snapshotId||risk.reasons.includes('JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT')||Date.parse(risk.validUntil)<=Date.parse(risk.asOf))throw new Error('STALE_CONFLICT');
  const quote=isin?snapshots[0].evidence.quotes[isin]:null;
  const feed=isin?assessHeldQuote(isin,risk.asOf,calendars[0]?.evidence??null,mapping,quote?{state:'KNOWN',quote}:{state:'UNKNOWN',reason:'QUOTE_UNAVAILABLE'}):null;
  const sourceMatches=!!scale&&scale===structures[0]?.evidence.input.scaleRevision;
  const currentQuote=feed?.state==='FEED_FRESH'&&listing?.listingId===event.listingId&&sourceMatches?quote:null;
  const days=calendars[0]?.evidence;
  let calendar:{date:string;opensAt:string;closesAt:string}[]|null=null;
  try{if(days?.length&&verifiedCalendar(days,event.session,days.map(d=>d.date).sort().at(-1)!,risk.asOf).state==='KNOWN')calendar=days.filter(d=>d.date>=event.session&&d.verified&&utcInstant(d.knownAt)<=utcInstant(risk.asOf)&&d.kind!=='HOLIDAY'&&d.opensAt&&d.closesAt).sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({date:d.date,opensAt:d.opensAt!,closesAt:d.closesAt!}))}catch{calendar=null}
  const decision=evaluateEntry({event,now:risk.asOf,calendar,continuousMarket:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',
   quote:currentQuote?{price:currentQuote.ltp,at:currentQuote.sourceAt}:null,
   heartbeatAt:null,brokerConnected:'UNKNOWN',sessionValid:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',tokenValid:listing?.listingId===event.listingId?'PASS':'UNKNOWN',brokerSettled:'UNKNOWN',
   gates:{G04:'UNKNOWN',G05:'UNKNOWN',G06:'UNKNOWN',G08:'UNKNOWN'},riskGates:{LOSS_STREAK:risk.lossStreak.pass===null?'UNKNOWN':risk.lossStreak.pass?'PASS':'FAIL'},regime:'UNKNOWN',tick:listing?.tick??'0.05'});
  const sector=isin?sectorAt(sectors[0]?.evidence.mappings??[],isin,risk.asOf).sector:null;
  const sizing=currentQuote&&decision.stop&&parseFixed(decision.stop)>0n&&isin&&listing?sizeEntry({portfolio:risk.valuation,isin,sector,entry:currentQuote.ltp,stop:decision.stop,regime:'UNKNOWN',lotSize:listing.lot,estimatedFees:request.estimatedFees,lossStreakPass:risk.lossStreak.pass}):null;
  const reasons=[...new Set([...risk.reasons,...decision.reasons,...(sizing?.reasons??['CAP_INPUTS_UNAVAILABLE']),...(!sourceMatches?['ENTRY_PRICE_SCALE_UNVERIFIED']:[]),'REGIME_EVIDENCE_REQUIRED'])];
  const expiresAt=new Date(Math.min(Date.parse(decision.expiresAt),Date.parse(risk.validUntil),...(currentQuote?[Date.parse(currentQuote.validUntil)]:[]))).toISOString();
  const id=hash([ownerId,key,requestHash,risk.journalHash,risk.asOf]),evidence={id,ownerId,request,marketEventId:event.id,snapshotId:risk.snapshotId,journalHash:risk.journalHash,asOf:risk.asOf,expiresAt,isin,state:'BUY_BLOCKED',reasons,
   quantity:0,entry:currentQuote?.ltp??null,stop:decision.stop,estimatedFees:request.estimatedFees,riskBudget:sizing?.riskBudget??null,caps:sizing?.caps??null,
   valuation:risk.valuation,lossStreak:risk.lossStreak,cashAllocationRevision:risk.cashAllocationRevision,entryEvidence:decision,sizing,executable:false};
  await tx.$executeRaw`INSERT INTO "EntryRiskPlan" ("id","ownerId","marketEventId","asOf","expiresAt","journalHash","evidence") VALUES (${id},${ownerId}::uuid,${event.id},${new Date(risk.asOf)},${new Date(expiresAt)},${risk.journalHash},${canonical(evidence)}::jsonb)`;
  const response=JSON.parse(canonical(evidence)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 },{timeout:15000});
}
export async function readEntryRisk(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  const plans=await tx.$queryRaw<{evidence:{id:string;journalHash:string;expiresAt:string;cashAllocationRevision?:string}}[]>`SELECT "evidence" FROM "EntryRiskPlan" WHERE "ownerId"=${ownerId}::uuid ORDER BY "asOf" DESC,"id" LIMIT 50`;
  return {items:plans.map(r=>{
   const reasons=[...(r.evidence.journalHash!==risk.journalHash?['JOURNAL_CHANGED_SINCE_PLAN']:[]),...(Date.parse(r.evidence.expiresAt)<=Date.now()?['PLAN_EXPIRED']:[]),...(r.evidence.cashAllocationRevision!==risk.cashAllocationRevision?['CASH_ALLOCATION_CHANGED_SINCE_PLAN']:[]),...risk.reasons];
   return {evidence:r.evidence,current:reasons.length===0,validityReasons:[...new Set(reasons)],executable:false};
  }),asOf:risk.asOf,executable:false};
 },{timeout:15000});
}

