import {assertCandlePermissions} from './data-permissions.js';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {replayRelativeStrength,type Series} from '@vcp/indicators';
import {benchmarkReadiness,readiness,verifiedCalendar,type GateProof,type CalendarDay,type InstrumentSnapshot,type UniverseSnapshot} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
import {ST_VCP_4_0,configurationHash} from '@vcp/strategy';
import {canonical} from './indicators.js';
export interface StrengthReplayInput {indicatorReceiptId:string;instrumentSnapshotId:string;profileId:string;universeSnapshotId:string;benchmarkAdjustmentId:string;benchmarkProofId:string;memberAdjustmentIds:Record<string,string>;evaluatedAt:string}
export async function persistRelativeStrengthReplay(db:PrismaClient,input:StrengthReplayInput){
 const now=utcInstant(input.evaluatedAt);if(now>new Date())throw new Error('RS_REPLAY_FUTURE_EVIDENCE');
 if(![input.indicatorReceiptId,input.instrumentSnapshotId,input.profileId,input.universeSnapshotId,input.benchmarkAdjustmentId,input.benchmarkProofId,...Object.values(input.memberAdjustmentIds)].every(v=>/^[0-9a-f]{64}$/.test(v)))throw new Error('INVALID_RS_REPLAY_IDENTITY');
 const adjustmentIds=[...new Set([input.benchmarkAdjustmentId,...Object.values(input.memberAdjustmentIds)])];
 const permissionRows=await db.$queryRaw<{evidence:{result:{bars:{rawRevisionId:string}[]}}}[]>`SELECT "evidence" FROM "AdjustmentSnapshot" WHERE "id"=ANY(${adjustmentIds}::text[])`;
 if(permissionRows.length!==adjustmentIds.length)throw new Error('RS_ADJUSTMENT_UNAVAILABLE');
 const revisionIds=permissionRows.flatMap(row=>row.evidence.result.bars.map(bar=>bar.rawRevisionId)),permission=await assertCandlePermissions(db,revisionIds,['DERIVE','STORE']);
 const id=createHash('sha256').update(canonical(input)).digest('hex');
 const existing=await db.$queryRaw<{evidence:StrengthReplayResult}[]>`SELECT "evidence" FROM "RelativeStrengthReplay" WHERE "id"=${id}`;
 if(existing[0])return existing[0].evidence;
 const receipts=await db.$queryRaw<{createdAt:Date;evidence:{listingId:string;adjustmentId:string;calendarHash:string;from:string;to:string;state:string}}[]>`SELECT "createdAt","evidence" FROM "IndicatorReplayReceipt" WHERE "id"=${input.indicatorReceiptId}`;
 const receipt=receipts[0];if(!receipt||receipt.createdAt>now||receipt.evidence.state!=='INDICATORS_REPLAYED')throw new Error('RS_INDICATOR_RECEIPT_UNAVAILABLE');const r=receipt.evidence;
 const universes=await db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "id"=${input.universeSnapshotId}`;
 const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${input.instrumentSnapshotId}`;
 const proofs=await db.$queryRaw<{evidence:GateProof}[]>`SELECT "evidence" FROM "ReadinessProof" WHERE "id"=${input.benchmarkProofId}`;
 const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${r.calendarHash}`;
 const profile=await db.strategyProfile.findUnique({where:{id:input.profileId}});
 const universe=universes[0]?.evidence,mapping=mappings[0]?.evidence,proof=proofs[0]?.evidence;
 if(!universe||universe.universe!=='NIFTY_500'||!universe.historicalConstituentsVerified||!universe.sourceReference||utcInstant(universe.knownAt)>now||universe.effectiveFrom>r.from||(universe.effectiveTo!==null&&universe.effectiveTo<=r.to))throw new Error('RS_HISTORICAL_UNIVERSE_UNAVAILABLE');
 if(!mapping||utcInstant(mapping.knownAt)>now||!profile||profile.createdAt>now||configurationHash(profile.configuration)!==configurationHash(ST_VCP_4_0))throw new Error('RS_CONTEXT_UNAVAILABLE');
 const details=proof?.details as {identifier?:string;adjustmentId?:string}|undefined;
 if(!proof||proof.gate!=='G04'||readiness([proof],input.evaluatedAt).items.find(p=>p.gate==='G04')?.status!=='PASS'||details?.identifier!=='NIFTY_500_PRICE'||details.adjustmentId!==input.benchmarkAdjustmentId)throw new Error('RS_BENCHMARK_PROOF_UNAVAILABLE');
 const calendar=verifiedCalendar(calendars[0]?.evidence??null,r.from,r.to,input.evaluatedAt);
 if(calendar.state!=='KNOWN')throw new Error('RS_CALENDAR_UNAVAILABLE');
 const sessions=calendar.sessions.map(day=>day.date);
 async function load(adjustmentId:string){
  const rows=await db.$queryRaw<{listingId:string;asOf:Date;state:string;evidence:{result:{bars:(Series['bars'][number]&{rawRevisionId:string})[]}}}[]>`SELECT "listingId","asOf","state","evidence" FROM "AdjustmentSnapshot" WHERE "id"=${adjustmentId}`;
  const row=rows[0];if(!row||row.state!=='KNOWN'||row.asOf>now)throw new Error('RS_ADJUSTMENT_UNAVAILABLE');
  const bars=row.evidence.result.bars.filter(b=>b.session>=r.from&&b.session<=r.to).map(b=>({...b,revision:b.rawRevisionId}));
  return {listingId:row.listingId,series:{priceScale:'ADJUSTED' as const,bars,sessions,asOf:input.evaluatedAt,dataRevision:adjustmentId}};
 }
 const benchmark=await load(input.benchmarkAdjustmentId);
 const gate=benchmarkReadiness({identifier:'NIFTY_500_PRICE',identityVerified:true,calendarVerified:true,expectedSessions:sessions,bars:benchmark.series.bars.map(b=>({...b,sourceRevision:b.revision})),asOf:input.evaluatedAt});
 const members:Record<string,Series|null>={};let targetIsin:string|null=null;
 for(const isin of universe.isins){
  const rows=mapping.rows.filter(row=>row.isin===isin&&row.enabled&&row.verified&&row.instrumentType==='EQUITY'&&row.validFrom<=r.from&&(row.validTo===null||row.validTo>r.to)&&((row.exchange==='NSE'&&row.series==='EQ')||(row.exchange==='BSE'&&row.series==='CASH')));
  const nse=rows.filter(row=>row.exchange==='NSE'),canonicalRows=nse.length?nse:rows;
  const listing=canonicalRows.length===1?canonicalRows[0]:undefined,adjustmentId=listing?input.memberAdjustmentIds[listing.listingId]:undefined;
  members[isin]=null;
  if(!listing||!adjustmentId)continue;
  const loaded=await load(adjustmentId);if(loaded.listingId!==listing.listingId)throw new Error('RS_LISTING_MISMATCH');
  if(listing.listingId===r.listingId){if(adjustmentId!==r.adjustmentId)throw new Error('RS_TARGET_REVISION_MISMATCH');targetIsin=isin}
  members[isin]=loaded.series;
 }
 if(!targetIsin)throw new Error('RS_TARGET_NOT_IN_UNIVERSE');
 const rows=gate.status==='PASS'?replayRelativeStrength({benchmark:benchmark.series,members,intended:universe.isins,sessions}):[];
 const result={id,input,listingId:r.listingId,targetIsin,mode:'RETROSPECTIVE_CORRECTION' as const,state:gate.status==='PASS'?'COMPUTED':'UNKNOWN',reasons:gate.reasons,rows,sessionTimes:Object.fromEntries(calendar.sessions.map(s=>[s.date,s.finalizedAt!]))};
 const current=await assertCandlePermissions(db,revisionIds,['DERIVE','STORE']);if(canonical(current.sourceSnapshotIds)!==canonical(permission.sourceSnapshotIds))throw new Error('SOURCE_AUTHORITY_CHANGED');
 await db.$executeRaw`INSERT INTO "RelativeStrengthReplay" ("id","indicatorReceiptId","instrumentSnapshotId","profileId","evidence") VALUES (${id},${input.indicatorReceiptId},${input.instrumentSnapshotId},${input.profileId},${canonical(result)}::jsonb) ON CONFLICT DO NOTHING`;
 return result;
}
export interface StrengthReplayResult {id:string;input:StrengthReplayInput;listingId:string;targetIsin:string;mode:'RETROSPECTIVE_CORRECTION';state:string;reasons:string[];rows:ReturnType<typeof replayRelativeStrength>;sessionTimes:Record<string,string>}
