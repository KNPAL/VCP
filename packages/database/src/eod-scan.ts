import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {utcInstant,sessionDate,exchangeDate} from '@vcp/domain';
import {verifiedCalendar,readiness,type CalendarDay,type ActionSnapshot,type GateProof,type Permission} from '@vcp/market-data';
import {validateSeries,relativeStrength,percentiles,adv20,snapshot,sma,marketRegime,type Series} from '@vcp/indicators';
import {companyCandidate,configurationHash,ST_VCP_4_0,type DailyStructureInput,type ScanOutcome} from '@vcp/strategy';
import {canonical,persistIndicator} from './indicators.js';
import {pinScanUniverse} from './instruments.js';
import {activeProfile} from './profiles.js';
import {processDailyStructure} from './daily-structure.js';
import {persistScan,getScan} from './scans.js';
import {assertCandlePermissions} from './data-permissions.js';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export interface EodScanRequest {scanId:string;session:string;asOf:string;calendarId:string}
interface Item {id:string;isin:string;instrumentId:string;adjustmentId:string|null;tick:string|null;reason:string|null;rs:string|null;rsRevision:string}
export interface RegimeEvidence {session:string;asOf:string;calendarId:string;benchmark:{adjustmentId:string|null;proofId:string|null;close:string|null;sma50:string|null;sma200:string|null};members:{isin:string;adjustmentId:string|null;close:string|null;sma50:string|null}[];intended:string[];result:ReturnType<typeof marketRegime>}
export interface Plan {request:EodScanRequest;configHash:string;dataRevision:string;universe:Awaited<ReturnType<typeof pinScanUniverse>>;benchmarkAdjustmentId:string|null;benchmarkProofId:string|null;regime?:RegimeEvidence;items:Item[]}
interface AdjustmentRow {id:string;listingId:string;asOf:Date;createdAt:Date;scaleSession:Date;state:string;evidence:{source:ActionSnapshot;result:{bars:(Series['bars'][number]&{rawRevisionId:string})[]}}}
class MissingInput extends Error {}
/** Reconstruct only the pinned revision, and reject future or incomplete evidence. */
export async function loadSeries(db:PrismaClient|Prisma.TransactionClient,id:string,request:EodScanRequest,operations:readonly Permission[]=['DERIVE','STORE']){
 const cutoff=utcInstant(request.asOf);
 const rows=await db.$queryRaw<AdjustmentRow[]>`SELECT * FROM "AdjustmentSnapshot" WHERE "id"=${id}`;
 const row=rows[0];if(!row||row.state!=='KNOWN'||row.asOf>cutoff||row.createdAt>cutoff||row.scaleSession.toISOString().slice(0,10)!==request.session)throw new MissingInput('ADJUSTMENT_UNAVAILABLE');
 const bars=row.evidence.result.bars;
 if(!bars.length||bars.at(-1)!.session!==request.session)throw new MissingInput('CURRENT_SESSION_MISSING');
 const calendars=await db.$queryRaw<{evidence:CalendarDay[];createdAt:Date}[]>`SELECT "evidence","createdAt" FROM "CalendarSnapshot" WHERE "id"=${request.calendarId}`;
 const calendar=verifiedCalendar(calendars[0]?.createdAt&&calendars[0].createdAt<=cutoff?calendars[0].evidence:null,bars[0]!.session,request.session,request.asOf);
 if(calendar.state!=='KNOWN'||canonical(calendar.sessions.map(s=>s.date))!==canonical(bars.map(b=>b.session)))throw new MissingInput('CALENDAR_OR_COVERAGE_INCOMPLETE');
 if(bars.some((b,i)=>!b.finalizedAt||utcInstant(b.finalizedAt)<utcInstant(calendar.sessions[i]!.finalizedAt!)))throw new MissingInput('CANDLE_FINALIZED_BEFORE_CALENDAR');
 const series:DailyStructureInput['series']={priceScale:'ADJUSTED',bars:bars.map((b,i)=>({...b,revision:b.rawRevisionId,endedAt:calendar.sessions[i]!.closesAt!})),sessions:calendar.sessions.map(s=>s.date),asOf:request.asOf,dataRevision:id};
 try{validateSeries(series)}catch{throw new MissingInput('INVALID_FINALIZED_SERIES')}
 const raw=await db.candleRevision.findMany({where:{id:{in:bars.map(b=>b.rawRevisionId)}}});
 if(raw.length!==bars.length||raw.some(b=>b.listingId!==row.listingId||b.receivedAt>cutoff||!b.finalizedAt||b.finalizedAt>cutoff))throw new MissingInput('RAW_SOURCE_NOT_YET_KNOWN');
 try{await assertCandlePermissions(db,raw.map(row=>row.id),operations)}catch(error){if(error instanceof Error&&['SOURCE_PERMISSION_REQUIRED','SOURCE_SCOPE_AMBIGUOUS','SOURCE_LINEAGE_MISSING'].includes(error.message))throw new MissingInput(error.message);throw error}
 const byId=new Map(raw.map(b=>[b.id,b]));
 const rawSeries:Series={...series,priceScale:'RAW',bars:bars.map(b=>{const r=byId.get(b.rawRevisionId)!;return {session:r.session.toISOString().slice(0,10),open:r.open.toFixed(6),high:r.high.toFixed(6),low:r.low.toFixed(6),close:r.close.toFixed(6),volume:r.volume.toString(),revision:r.id,finalizedAt:r.finalizedAt!.toISOString(),adjustmentVerified:false}})};
 // The basis stays stable across daily snapshots and changes for action revisions.
 const actions=row.evidence.source.actions.filter(a=>exchangeDate(a.effectiveAt)<=request.session).sort((a,b)=>a.id.localeCompare(b.id));
 return {listingId:row.listingId,series,scaleRevision:hash(actions),adv:adv20(rawSeries)};
}
async function assertPlanPermissions(db:PrismaClient|Prisma.TransactionClient,plan:Plan,operations:readonly Permission[]=['DERIVE','STORE']){
 const ids=[...new Set([plan.benchmarkAdjustmentId,...plan.items.map(item=>item.adjustmentId)].filter((id):id is string=>id!==null))];
 if(!ids.length)return;
 const rows=await db.$queryRaw<AdjustmentRow[]>`SELECT * FROM "AdjustmentSnapshot" WHERE "id"=ANY(${ids}::text[])`;
 if(rows.length!==ids.length||rows.some(row=>!Array.isArray(row.evidence.result?.bars)||!row.evidence.result.bars.length))throw new Error('SOURCE_LINEAGE_MISSING');
 await assertCandlePermissions(db,rows.flatMap(row=>row.evidence.result.bars.map(bar=>bar.rawRevisionId)),operations);
}
/** Public displays must verify the original contributors, never today's replacement universe. */
export async function assertEodScanDisplay(db:PrismaClient,id:string){
 const rows=await db.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "EodScanPlan" WHERE "id"=${id}::uuid`;
 if(!rows[0])throw new Error('SOURCE_LINEAGE_MISSING');
 await assertPlanPermissions(db,rows[0].evidence,['DISPLAY','DERIVE']);
}
export async function prepareEodScan(db:PrismaClient,request:EodScanRequest){
 request=structuredClone(request);if(!uuid(request.scanId)||!/^[0-9a-f]{64}$/.test(request.calendarId))throw new Error('INVALID_SCAN_REQUEST');
 sessionDate(request.session);const at=utcInstant(request.asOf);if(at>new Date()||request.session>exchangeDate(request.asOf))throw new Error('SCAN_FUTURE_REQUEST');
 if(request.session!==exchangeDate(request.asOf))throw new Error('SCAN_SESSION_ASOF_MISMATCH');
 const prior=await db.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "EodScanPlan" WHERE "id"=${request.scanId}::uuid`;
 if(prior[0]){if(canonical(prior[0].evidence.request)!==canonical(request))throw new Error('SCAN_REQUEST_CONFLICT');await assertPlanPermissions(db,prior[0].evidence);return prior[0].evidence}
 const profile=await activeProfile(db,request.asOf);
 if(!profile||configurationHash(profile.configuration)!==configurationHash(ST_VCP_4_0))throw new Error('SCAN_ACTIVE_PROFILE_UNAVAILABLE');
 const universe=await pinScanUniverse(db,request.scanId,request.asOf);
 if(universe.universe.state!=='KNOWN'||!universe.universe.members.length)throw new Error('SCAN_VERIFIED_UNIVERSE_UNAVAILABLE');
 const calendars=await db.$queryRaw<{evidence:CalendarDay[];createdAt:Date}[]>`SELECT "evidence","createdAt" FROM "CalendarSnapshot" WHERE "id"=${request.calendarId}`;
 const day=verifiedCalendar(calendars[0]?.createdAt&&calendars[0].createdAt<=at?calendars[0].evidence:null,request.session,request.session,request.asOf);
 if(day.state!=='KNOWN'||day.sessions.length!==1)throw new Error('SCAN_SESSION_NOT_FINAL');
 const proofs=await db.$queryRaw<{id:string;evidence:GateProof}[]>`SELECT "id","evidence" FROM "ReadinessProof" WHERE "gate"='G04' AND "probeAt"<=${at} ORDER BY "probeAt" DESC,"id" LIMIT 1`;
 const proof=proofs[0],details=proof?.evidence.details as {identifier?:string;adjustmentId?:string}|undefined;
 let benchmark:Awaited<ReturnType<typeof loadSeries>>|null=null,benchmarkAdjustmentId:string|null=null;
 if(proof&&readiness([proof.evidence],request.asOf).items.find(g=>g.gate==='G04')?.status==='PASS'&&details?.identifier==='NIFTY_500_PRICE'&&details.adjustmentId){
  try{benchmark=await loadSeries(db,details.adjustmentId,request);benchmarkAdjustmentId=details.adjustmentId}catch(e){if(!(e instanceof MissingInput))throw e}
 }
 const rawStrength:{isin:string;value:string|null}[]=[],items:Item[]=[],breadth:RegimeEvidence['members']=[];
 for(const member of universe.listings){
  const listing=member.primary;let adjustmentId:string|null=null,reason=member.reason,value:string|null=null,close:string|null=null,average:string|null=null;
  if(listing){
   const adjustments=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "AdjustmentSnapshot" WHERE "listingId"=${listing.listingId}::uuid AND "asOf"<=${at} AND "createdAt"<=${at} ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`;
   adjustmentId=adjustments[0]?.id??null;
   if(!adjustmentId)reason='ADJUSTMENT_UNAVAILABLE';
   else try{const loaded=await loadSeries(db,adjustmentId,request);if(loaded.listingId!==listing.listingId)throw new MissingInput('SCAN_LISTING_MISMATCH');close=loaded.series.bars.at(-1)!.close;average=sma(loaded.series,50).value;if(benchmark){const rs=relativeStrength(loaded.series,benchmark.series);value=rs.state==='KNOWN'?rs.value!.raw:null}}catch(e){if(!(e instanceof MissingInput))throw e;reason=e.message;adjustmentId=null}
  }
  rawStrength.push({isin:member.isin,value});
  breadth.push({isin:member.isin,adjustmentId,close,sma50:average});
  items.push({id:hash([request.scanId,member.isin]),isin:member.isin,instrumentId:listing?.listingId??'isin:'+member.isin,adjustmentId,tick:listing?.tick??null,reason,rs:null,rsRevision:''});
 }
 const ranks=percentiles(universe.universe.members,rawStrength),rsRevision=hash({benchmarkAdjustmentId,proofId:proof?.id??null,rawStrength,ranks});
 for(const item of items){item.rs=ranks.state==='KNOWN'?ranks.values[item.isin]??null:null;item.rsRevision=rsRevision}
 const benchmarkInputs={adjustmentId:benchmarkAdjustmentId,proofId:proof?.id??null,close:benchmark?.series.bars.at(-1)?.close??null,sma50:benchmark?sma(benchmark.series,50).value:null,sma200:benchmark?sma(benchmark.series,200).value:null};
 // Store the full intended denominator, including missing members, with pinned source revisions.
 // This is historical EOD evidence; live entry consumers must separately verify freshness.
 const regime:RegimeEvidence={session:request.session,asOf:request.asOf,calendarId:request.calendarId,benchmark:benchmarkInputs,members:breadth,intended:universe.universe.members,result:marketRegime(benchmarkInputs.close,benchmarkInputs.sma50,benchmarkInputs.sma200,universe.universe.members,breadth)};
 const base={request,configHash:profile.id,universe,benchmarkAdjustmentId,benchmarkProofId:proof?.id??null,regime,items},plan:Plan={...base,dataRevision:hash(base)};
 await db.$transaction(async tx=>{
  await assertPlanPermissions(tx,plan);
  await tx.$executeRaw`INSERT INTO "EodScanPlan" ("id","evidence") VALUES (${request.scanId}::uuid,${canonical(plan)}::jsonb) ON CONFLICT DO NOTHING`;
  const saved=await tx.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "EodScanPlan" WHERE "id"=${request.scanId}::uuid`;
  if(canonical(saved[0]?.evidence)!==canonical(plan))throw new Error('SCAN_PLAN_CONFLICT');
  for(const item of items)await tx.$executeRaw`INSERT INTO "EodScanItem" ("id","scanId","evidence") VALUES (${item.id},${request.scanId}::uuid,${canonical(item)}::jsonb) ON CONFLICT DO NOTHING`;
 },{timeout:30000});return plan;
}
export async function processEodScanItem(db:PrismaClient,id:string){
 if(!/^[0-9a-f]{64}$/.test(id))throw new Error('INVALID_SCAN_ITEM');
 const rows=await db.$queryRaw<{scanId:string;evidence:Item}[]>`SELECT "scanId","evidence" FROM "EodScanItem" WHERE "id"=${id}`;
 const row=rows[0];if(!row)throw new Error('SCAN_ITEM_NOT_FOUND');
 const plans=await db.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "EodScanPlan" WHERE "id"=${row.scanId}::uuid`;const plan=plans[0]!.evidence,item=row.evidence;
 await assertPlanPermissions(db,plan);
 const prior=await db.$queryRaw<{evidence:ScanOutcome}[]>`SELECT "evidence" FROM "EodScanCheckpoint" WHERE "itemId"=${id}`;
 let outcome=prior[0]?.evidence;
 if(!outcome){
  if(item.reason||!item.adjustmentId||!item.tick)outcome={instrumentId:item.instrumentId,status:'MISSING',reasons:[item.reason??'PINNED_INPUT_UNAVAILABLE'],candidate:null};
  else {
   const loaded=await loadSeries(db,item.adjustmentId,plan.request);
   if(loaded.listingId!==item.instrumentId)throw new Error('SCAN_LISTING_MISMATCH');
   const input:DailyStructureInput={listingId:item.instrumentId,series:loaded.series,tick:item.tick,adjustmentRevision:item.adjustmentId,scaleRevision:loaded.scaleRevision,configHash:plan.configHash,decidedAt:plan.request.asOf,strength:item.rs===null?null:{value:item.rs,revision:item.rsRevision,knownAt:plan.request.asOf}};
   const daily=await processDailyStructure(db,input).catch((error:unknown)=>{
    if(error instanceof Error&&error.message==='DAILY_SESSION_ALREADY_FROZEN')return null;
    throw error;
   });
   if(!daily)outcome={instrumentId:item.instrumentId,status:'MISSING',reasons:['DAILY_SESSION_ALREADY_FROZEN_REPLAY_REQUIRED'],candidate:null};
   else {
   await persistIndicator(db,{listingId:item.instrumentId,session:plan.request.session,dataRevision:hash([item.adjustmentId,item.rsRevision]),asOf:plan.request.asOf,evidence:JSON.parse(canonical(snapshot(loaded.series,item.rs)))});
   const reasons=[...(item.rs===null?['RS_UNAVAILABLE']:[]),...(loaded.adv.state!=='KNOWN'?['ADV_UNAVAILABLE']:!loaded.adv.value!.eligible?['TURNOVER_BELOW_MINIMUM']:[])];
   const candidate=companyCandidate({listingId:item.instrumentId,patterns:daily.detector.structure.patterns,close:loaded.series.bars.at(-1)!.close,rsPercentile:item.rs,adv20Median:loaded.adv.value?.median??null,dataReasons:reasons,confirmedMarketEventId:daily.breakout.state==='BREAKOUT_CONFIRMED'?daily.breakout.event!.id:null});
   outcome={instrumentId:item.instrumentId,status:'ANALYZED',reasons,candidate,dailyExecutionId:daily.id};
   }
  }
  await assertPlanPermissions(db,plan);
  await db.$executeRaw`INSERT INTO "EodScanCheckpoint" ("itemId","evidence") VALUES (${id},${canonical(outcome)}::jsonb) ON CONFLICT DO NOTHING`;
  const saved=await db.$queryRaw<{evidence:ScanOutcome}[]>`SELECT "evidence" FROM "EodScanCheckpoint" WHERE "itemId"=${id}`;
  if(canonical(saved[0]?.evidence)!==canonical(outcome))throw new Error('SCAN_CHECKPOINT_CONFLICT');
 }
 const completed=await db.$queryRaw<{evidence:ScanOutcome}[]>`SELECT c."evidence" FROM "EodScanCheckpoint" c JOIN "EodScanItem" i ON i."id"=c."itemId" WHERE i."scanId"=${row.scanId}::uuid`;
 if(completed.length===plan.items.length)await persistScan(db,{scanId:row.scanId,asOf:plan.request.asOf,configHash:plan.configHash,dataRevision:plan.dataRevision},plan.items.map(i=>i.instrumentId),completed.map(c=>c.evidence));
 return {itemId:id,outcome,scanComplete:completed.length===plan.items.length};
}
export async function pendingEodScanItems(db:PrismaClient){return db.$queryRaw<{id:string}[]>`SELECT i."id" FROM "EodScanItem" i LEFT JOIN "EodScanCheckpoint" c ON c."itemId"=i."id" LEFT JOIN "EodScanDispatch" d ON d."itemId"=i."id" WHERE c."itemId" IS NULL OR NOT EXISTS (SELECT 1 FROM "ScanResult" s WHERE s."id"=i."scanId") ORDER BY COALESCE(d."checkedAt",i."createdAt"),i."id" LIMIT 25`}
export async function recordEodScanDispatch(db:PrismaClient,id:string,state:string){await db.$executeRaw`INSERT INTO "EodScanDispatch" ("itemId","state") VALUES (${id},${state}) ON CONFLICT ("itemId") DO UPDATE SET "state"=EXCLUDED."state","checkedAt"=CURRENT_TIMESTAMP`}
export async function eodScanProgress(db:PrismaClient,scanId:string){
 const plans=await db.$queryRaw<{evidence:Plan}[]>`SELECT "evidence" FROM "EodScanPlan" WHERE "id"=${scanId}::uuid`;if(!plans[0])return null;
 const items=await db.$queryRaw<{id:string;checkpoint:unknown;dispatchState:string|null}[]>`SELECT i."id",c."evidence" AS checkpoint,d."state" AS "dispatchState" FROM "EodScanItem" i LEFT JOIN "EodScanCheckpoint" c ON c."itemId"=i."id" LEFT JOIN "EodScanDispatch" d ON d."itemId"=i."id" WHERE i."scanId"=${scanId}::uuid ORDER BY i."id"`;
 return {scanId,request:plans[0].evidence.request,dataRevision:plans[0].evidence.dataRevision,regime:plans[0].evidence.regime??null,intended:items.length,completed:items.filter(i=>i.checkpoint!==null).length,items,result:await getScan(db,scanId)};
}

