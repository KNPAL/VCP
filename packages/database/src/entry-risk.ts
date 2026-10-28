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
import {getReadiness} from './readiness.js';
import {ownerStreamBinding} from './broker-stream-binding.js';
import {readSurveillance} from './surveillance.js';
import {authorizeEntryPlan,sameEntryQuote} from './entry-authorization.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type LiveEntryObservation={quote:PortfolioQuotes[string];heartbeatAt:string;validUntil:string;bindingRevision:string;settled:boolean};
export type EntryObservationReader=(ownerId:string,listingId:string)=>Promise<LiveEntryObservation|null>;
/** Bind plans to current sources without treating a source fingerprint as permission. */
async function entrySource(tx:Prisma.TransactionClient,ownerId:string,eventId:string,asOf:string){
 const rows=await tx.$queryRaw<{id:string;listingId:string;currentId:string|null}[]>`SELECT e."id",e."listingId",(SELECT n."id" FROM "MarketEvent" n WHERE n."logicalId"=e."logicalId" AND n."decidedAt"<=${new Date(asOf)} AND n."observedAt"<=${new Date(asOf)} AND n."occurredAt"<=${new Date(asOf)} ORDER BY n."decidedAt" DESC,n."id" DESC LIMIT 1) AS "currentId" FROM "MarketEvent" e WHERE e."id"=${eventId}`;
 const event=rows[0],readiness=await getReadiness(tx,asOf),binding=await ownerStreamBinding(tx,ownerId),scale=event?await actionScale(tx,event.listingId,asOf):null;
 const restrictions=event?await readSurveillance(tx,event.listingId,asOf):null;
 const profiles=await tx.$queryRaw<{profileId:string}[]>`SELECT "profileId" FROM "StrategyActivation" WHERE "activatedAt"<=${new Date(asOf)} AND "knownAt"<=${new Date(asOf)} ORDER BY "activatedAt" DESC,"knownAt" DESC,"id" DESC LIMIT 1`;
 const gates=readiness.items.filter(item=>!['G04','G05','G06','G08'].includes(item.gate));
 return {revision:hash({event:event?.currentId??null,scale,binding,profileId:profiles[0]?.profileId??null,surveillance:{revision:restrictions?.revision??null,status:restrictions?.status??'UNKNOWN'},gates:readiness.items.map(item=>({gate:item.gate,status:item.status,proofId:item.proof?.id??null}))}),listingId:event?.listingId??null,profileId:profiles[0]?.profileId??null,gateReasons:gates.filter(g=>g.status!=='PASS').map(g=>g.gate+'_'+g.status),gateExpires:gates.filter(g=>g.status==='PASS'&&g.proof).map(g=>g.proof!.expiresAt),current:!!event&&event.id===event.currentId,restrictions,bindingRevision:hash([binding.revision,binding.sessionRevision])};
}
export type EntryRiskRequest={marketEventId:string;snapshotId:string;estimatedFees:string;topUpQuantity?:number};
/** User selects an existing event and observation. No user-supplied quote or PASS gate is accepted. */
export async function recordEntryRisk(db:PrismaClient,ownerId:string,key:string,request:EntryRiskRequest,readObservation?:EntryObservationReader){
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
  const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=clock_timestamp() ORDER BY "createdAt" DESC,"id" LIMIT 1`;
  const sectors=await tx.$queryRaw<{id:string;evidence:{mappings:SectorMapping[]}}[]>`SELECT "id","evidence" FROM "SectorSnapshot" WHERE "knownAt"<=clock_timestamp() ORDER BY "knownAt" DESC,"id" LIMIT 1`;
  const structures=await tx.$queryRaw<{evidence:{input:{scaleRevision:string}}}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${event.listingId}::uuid AND "evidence"->'breakout'->'event'->>'id'=${event.id} LIMIT 1`;
  const mapping=mappings[0]?.evidence??null,isin=mapping?.rows.find(r=>r.listingId===event.listingId)?.isin??null;
  const before=new Date().toISOString(),listing=isin?canonicalListings(mapping?[mapping]:[],[isin],before)[0]?.primary:null;
  const scale=listing?await actionScale(tx,listing.listingId,before):null;
  const regimeEvidence=await readCurrentRegime(tx,before);
  const source=await entrySource(tx,ownerId,event.id,new Date().toISOString());
  const observation=readObservation?await readObservation(ownerId,event.listingId).catch(()=>null):null;
  // Last read is the owner-locked, journal-bound valuation; it checks quote deadlines again.
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  if(risk.snapshotId!==request.snapshotId||risk.reasons.includes('JOURNAL_CHANGED_SINCE_RISK_SNAPSHOT')||Date.parse(risk.validUntil)<=Date.parse(risk.asOf))throw new Error('STALE_CONFLICT');
  const regime=Date.parse(regimeEvidence.validUntil)>Date.parse(risk.asOf)?regimeEvidence.regime:'UNKNOWN';
  const binding=await ownerStreamBinding(tx,ownerId),bindingRevision=hash([binding.revision,binding.sessionRevision]);
  const live=observation&&binding.name&&source.bindingRevision===bindingRevision&&observation.bindingRevision===bindingRevision&&Date.parse(observation.validUntil)>Date.now()&&Date.parse(observation.heartbeatAt)<=Date.now()&&Date.now()-Date.parse(observation.heartbeatAt)<=30000?observation:null;
  const quote=live?.quote??(isin?snapshots[0].evidence.quotes[isin]:null);
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
  const surveillanceCurrent=source.restrictions&&Date.parse(source.restrictions.validUntil)>Date.parse(risk.asOf)?source.restrictions:null;
  const outsideBand=!!currentQuote&&surveillanceCurrent?.status==='PASS'&&surveillanceCurrent.lowerBand!==null&&surveillanceCurrent.upperBand!==null&&(parseFixed(currentQuote.ltp)<parseFixed(surveillanceCurrent.lowerBand)||parseFixed(currentQuote.ltp)>parseFixed(surveillanceCurrent.upperBand));
  const decision=evaluateEntry({event,now:risk.asOf,calendar,continuousMarket:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',
   quote:currentQuote?{price:currentQuote.ltp,at:currentQuote.sourceAt}:null,
   heartbeatAt:live?.heartbeatAt??null,brokerConnected:live?'PASS':'UNKNOWN',sessionValid:feed?.state==='FEED_FRESH'?'PASS':'UNKNOWN',tokenValid:listing?.listingId===event.listingId?'PASS':'UNKNOWN',brokerSettled:live?.settled?'PASS':'UNKNOWN',
   gates:{G04:regime==='UNKNOWN'?'UNKNOWN':'PASS',G05:sector?'PASS':'UNKNOWN',G06:outsideBand?'FAIL':surveillanceCurrent?.status??'UNKNOWN',G08:risk.reconciliation.state==='RECONCILED_AS_OF'?'PASS':'UNKNOWN'},riskGates,regime,tick:listing?.tick??'0.05'});
  const reasons=[...new Set([...risk.reasons,...decision.reasons,...(!source.current?['MARKET_EVENT_SUPERSEDED_OR_NOT_KNOWN']:[]),...(sizing?.reasons??['CAP_INPUTS_UNAVAILABLE']),...(!sourceMatches?['ENTRY_PRICE_SCALE_UNVERIFIED']:[]),...regimeEvidence.reasons,...(regime==='UNKNOWN'?['REGIME_EVIDENCE_REQUIRED']:[])])];
  reasons.push(...(surveillanceCurrent?.reasons??['SURVEILLANCE_MISSING_OR_EXPIRED']));
  if(outsideBand)reasons.push('PRICE_OUTSIDE_VERIFIED_BAND');
  reasons.push(...source.gateReasons);
  if(source.profileId!==event.configHash)reasons.push('STRATEGY_PROFILE_CHANGED_OR_UNVERIFIED');
  if(stop!==decision.stop)reasons.push('STOP_BASIS_MISMATCH');
  if(isin&&risk.journal.holdings[isin]&&request.topUpQuantity===undefined)reasons.push('MANUAL_TOPUP_QUANTITY_REQUIRED');
  const expiresAt=new Date(Math.min(Date.parse(decision.expiresAt),Date.parse(risk.validUntil),...source.gateExpires.map(Date.parse),...(live?[Date.parse(live.validUntil)]:[]),...(surveillanceCurrent?.status==='PASS'?[Date.parse(surveillanceCurrent.validUntil)]:[]),...(regime!=='UNKNOWN'?[Date.parse(regimeEvidence.validUntil)]:[]),...(currentQuote?[Date.parse(currentQuote.validUntil)]:[]))).toISOString();
  const authorization=authorizeEntryPlan({decision,sizing,reasons,live:!!live,expiresAt,now:new Date().toISOString()});
  const id=hash([ownerId,key,requestHash,risk.journalHash,risk.asOf]),evidence={id,ownerId,request,marketEventId:event.id,snapshotId:risk.snapshotId,journalHash:risk.journalHash,asOf:risk.asOf,expiresAt,...authorization,
   isin,entry:currentQuote?.ltp??null,stop,proposalType:request.topUpQuantity===undefined?'ENTRY':'MANUAL_TOPUP',automatedAdd:false,estimatedFees:request.estimatedFees,riskBudget:sizing?.riskBudget??null,caps:sizing?.caps??null,
   liveObservation:live,sourceRevision:source.revision,sourceIds:{mappingId:mapping?.id??null,calendarId:calendars[0]?.id??null},readinessEvidence:{sectorId:sectors[0]?.id??null,sector,reconciliation:risk.reconciliation,surveillance:source.restrictions},regimeEvidence,valuation:risk.valuation,lossStreak:risk.lossStreak,cashAllocationRevision:risk.cashAllocationRevision,entryEvidence:decision,sizing,executable:false};
  await tx.$executeRaw`INSERT INTO "EntryRiskPlan" ("id","ownerId","marketEventId","asOf","expiresAt","journalHash","evidence") VALUES (${id},${ownerId}::uuid,${event.id},${new Date(risk.asOf)},${new Date(expiresAt)},${risk.journalHash},${canonical(evidence)}::jsonb)`;
  const response=JSON.parse(canonical(evidence)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.create({data:{ownerId,key:identity,requestHash,response}});return response;
 },{timeout:15000});
}
export async function readEntryRisk(db:PrismaClient,ownerId:string,readObservation?:EntryObservationReader){
 return db.$transaction(async tx=>{
  const risk=await readPortfolioRiskTransaction(tx,ownerId);
  const regime=await readCurrentRegime(tx,risk.asOf);
  const plans=await tx.$queryRaw<{evidence:{id:string;state:string;snapshotId:string;liveObservation?:LiveEntryObservation|null;marketEventId:string;sourceRevision?:string;sourceIds?:{mappingId:string|null;calendarId:string|null};journalHash:string;expiresAt:string;cashAllocationRevision?:string;readinessEvidence?:{sectorId:string|null};regimeEvidence?:{revision:string|null}}}[]>`SELECT "evidence" FROM "EntryRiskPlan" WHERE "ownerId"=${ownerId}::uuid ORDER BY "asOf" DESC,"id" LIMIT 50`;
  const sources=new Map<string,Awaited<ReturnType<typeof entrySource>>>();
  for(const row of plans)if(!sources.has(row.evidence.marketEventId))sources.set(row.evidence.marketEventId,await entrySource(tx,ownerId,row.evidence.marketEventId,new Date().toISOString()));
  const liveReads=new Map<string,LiveEntryObservation|null>();
  for(const row of plans){const listingId=sources.get(row.evidence.marketEventId)?.listingId;if(row.evidence.state==='BUY_ELIGIBLE'&&Date.parse(row.evidence.expiresAt)>Date.now()&&listingId&&!liveReads.has(listingId))liveReads.set(listingId,readObservation?await readObservation(ownerId,listingId).catch(()=>null):null)}
  return {items:plans.map(r=>{
   const reasons=[...(r.evidence.journalHash!==risk.journalHash?['JOURNAL_CHANGED_SINCE_PLAN']:[]),...(Date.parse(r.evidence.expiresAt)<=Date.now()?['PLAN_EXPIRED']:[]),...(r.evidence.cashAllocationRevision!==risk.cashAllocationRevision?['CASH_ALLOCATION_CHANGED_SINCE_PLAN']:[]),...(regime.regime==='UNKNOWN'||r.evidence.regimeEvidence?.revision!==regime.revision?['REGIME_CHANGED_OR_UNAVAILABLE']:[]),...(r.evidence.readinessEvidence?.sectorId!==risk.sources.sectorId?['SECTOR_EVIDENCE_CHANGED']:[]),...risk.reasons];
   const source=sources.get(r.evidence.marketEventId)!;
   if(!source.current)reasons.push('MARKET_EVENT_SUPERSEDED_OR_NOT_KNOWN');
   if(source.revision!==r.evidence.sourceRevision)reasons.push('ENTRY_SOURCE_CHANGED_OR_UNVERIFIED');
   if(r.evidence.sourceIds?.mappingId!==risk.sources.mappingId)reasons.push('INSTRUMENT_MAPPING_CHANGED');
   if(r.evidence.sourceIds?.calendarId!==risk.sources.calendarId)reasons.push('CALENDAR_EVIDENCE_CHANGED');
   if(r.evidence.snapshotId!==risk.snapshotId)reasons.push('PORTFOLIO_VALUATION_CHANGED');
   if(r.evidence.state==='BUY_ELIGIBLE'){
    const live=source.listingId?liveReads.get(source.listingId):null,prior=r.evidence.liveObservation;
    if(!live||!prior||live.bindingRevision!==source.bindingRevision||live.bindingRevision!==prior.bindingRevision||!live.settled||Date.parse(live.validUntil)<=Date.now()||Date.parse(live.heartbeatAt)>Date.now()||Date.now()-Date.parse(live.heartbeatAt)>30000)reasons.push('LIVE_ENTRY_EVIDENCE_CHANGED_OR_UNAVAILABLE');
    else if(!sameEntryQuote(live.quote,prior.quote))reasons.push('QUOTE_CHANGED_SINCE_PLAN');
   }
   return {evidence:r.evidence,current:reasons.length===0,validityReasons:[...new Set(reasons)],executable:false};
  }),asOf:risk.asOf,executable:false};
 },{timeout:15000});
}




