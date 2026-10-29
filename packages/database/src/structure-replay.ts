import {createHash} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {replayStructure,ST_VCP_4_0,configurationHash,type ReplayStrength} from '@vcp/strategy';
import type {InstrumentSnapshot,CalendarDay} from '@vcp/market-data';
import {verifiedCalendar} from '@vcp/market-data';
import type {Series} from '@vcp/indicators';
import {canonical} from './indicators.js';
import type {StrengthReplayResult} from './rs-replay.js';
import {assertCandlePermissions} from './data-permissions.js';
export interface StructureReplayInput {indicatorReceiptId:string;instrumentSnapshotId:string;profileId:string;strengthReplayId?:string}
export async function replayStoredStructure(db:PrismaClient,input:StructureReplayInput){
 if(!Object.values(input).every(id=>typeof id==='string'&&/^[0-9a-f]{64}$/.test(id)))throw new Error('INVALID_STRUCTURE_REPLAY_IDENTITY');
 const id=createHash('sha256').update(canonical(input)).digest('hex');
 const prior=await db.$queryRaw<{evidence:Prisma.JsonValue}[]>`SELECT "evidence" FROM "StructureReplayResult" WHERE "id"=${id}`;
 const receipts=await db.$queryRaw<{createdAt:Date;evidence:{listingId:string;adjustmentId:string;calendarHash:string;dataRevision:string;asOf:string;from:string;to:string;state:string}}[]>`SELECT "createdAt","evidence" FROM "IndicatorReplayReceipt" WHERE "id"=${input.indicatorReceiptId}`;
 const receipt=receipts[0];if(!receipt||receipt.evidence.state!=='INDICATORS_REPLAYED')throw new Error('INDICATOR_REPLAY_REQUIRED');
 const r=receipt.evidence;
 const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${input.instrumentSnapshotId}`;
 const mapping=mappings[0]?.evidence;
 const profile=await db.strategyProfile.findUnique({where:{id:input.profileId}});
 if(!mapping||!profile||configurationHash(profile.configuration)!==configurationHash(ST_VCP_4_0)||profile.createdAt>new Date()||new Date(mapping.knownAt)>new Date())throw new Error('REPLAY_CONTEXT_UNAVAILABLE');
 const snapshots=await db.$queryRaw<{evidence:{result:{bars:(Series['bars'][number]&{rawRevisionId:string})[]}}}[]>`SELECT "evidence" FROM "AdjustmentSnapshot" WHERE "id"=${r.adjustmentId}`;
 const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${r.calendarHash}`;
 const calendar=verifiedCalendar(calendars[0]?.evidence??null,r.from,r.to,r.asOf);
 const adjusted=snapshots[0]?.evidence.result.bars;
 if(!adjusted||calendar.state!=='KNOWN'||canonical(calendar.sessions.map(d=>d.date))!==canonical(adjusted.map(b=>b.session)))throw new Error('REPLAY_CALENDAR_INCOMPLETE');
 const revisionIds=adjusted.map(bar=>bar.rawRevisionId);
 if(input.strengthReplayId){
  const strength=await db.$queryRaw<{evidence:StrengthReplayResult}[]>`SELECT "evidence" FROM "RelativeStrengthReplay" WHERE "id"=${input.strengthReplayId}`;
  if(!strength[0])throw new Error('RS_REPLAY_CONTEXT_MISMATCH');
  const adjustmentIds=[...new Set([strength[0].evidence.input.benchmarkAdjustmentId,...Object.values(strength[0].evidence.input.memberAdjustmentIds)])];
  const sources=await db.$queryRaw<{evidence:{result:{bars:{rawRevisionId:string}[]}}}[]>`SELECT "evidence" FROM "AdjustmentSnapshot" WHERE "id"=ANY(${adjustmentIds}::text[])`;
  if(sources.length!==adjustmentIds.length)throw new Error('SOURCE_LINEAGE_MISSING');
  revisionIds.push(...sources.flatMap(row=>row.evidence.result.bars.map(bar=>bar.rawRevisionId)));
 }
 const permission=await assertCandlePermissions(db,revisionIds,['DERIVE','STORE']);
 if(prior[0])return prior[0].evidence;
 const ticks=adjusted.map(bar=>{
  const rows=mapping.rows.filter(row=>row.listingId===r.listingId&&row.verified&&row.enabled&&row.instrumentType==='EQUITY'&&((row.exchange==='NSE'&&row.series==='EQ')||(row.exchange==='BSE'&&row.series==='CASH'))&&row.validFrom<=bar.session&&(row.validTo===null||row.validTo>bar.session));
  if(rows.length!==1)throw new Error('REPLAY_INSTRUMENT_UNAVAILABLE');return rows[0]!.tick;
 });
 if(new Set(ticks).size!==1)throw new Error('REPLAY_TICK_CHANGE_UNSUPPORTED');
 const strength:Record<string,ReplayStrength>={};let strengthKnownAt=0;
 if(input.strengthReplayId){
  const storedStrength=await db.$queryRaw<{evidence:StrengthReplayResult;createdAt:Date}[]>`SELECT "evidence","createdAt" FROM "RelativeStrengthReplay" WHERE "id"=${input.strengthReplayId}`;
  const context=storedStrength[0];
  if(!context||context.evidence.input.indicatorReceiptId!==input.indicatorReceiptId||context.evidence.input.instrumentSnapshotId!==input.instrumentSnapshotId||context.evidence.input.profileId!==input.profileId||context.evidence.listingId!==r.listingId)throw new Error('RS_REPLAY_CONTEXT_MISMATCH');
  strengthKnownAt=Math.max(context.createdAt.valueOf(),new Date(context.evidence.input.evaluatedAt).valueOf());
  for(const row of context.evidence.rows){const value=row.values[context.evidence.targetIsin];if(row.state==='KNOWN'&&value!==null&&value!==undefined)strength[row.session]={value,revision:context.evidence.id,knownAt:new Date(strengthKnownAt).toISOString(),mode:'RETROSPECTIVE_CORRECTION',session:row.session,asOf:context.evidence.sessionTimes[row.session]!}}
 }
 const decidedAt=new Date(Math.max(receipt.createdAt.valueOf(),profile.createdAt.valueOf(),new Date(mapping.knownAt).valueOf(),strengthKnownAt)).toISOString();
 const bars=adjusted.map((bar,i)=>({...bar,revision:bar.rawRevisionId,endedAt:calendar.sessions[i]!.closesAt!}));
 const sessions=replayStructure({listingId:r.listingId,series:{priceScale:'ADJUSTED',bars,sessions:bars.map(b=>b.session),asOf:r.asOf,dataRevision:id},tick:ticks[0]!,adjustmentRevision:r.adjustmentId,configHash:profile.id,decidedAt,strength});
 const complete=sessions.length>=252&&sessions.slice(250).every(s=>s.rs.state==='KNOWN');
 const current=await assertCandlePermissions(db,revisionIds,['DERIVE','STORE']);if(canonical(current.sourceSnapshotIds)!==canonical(permission.sourceSnapshotIds))throw new Error('SOURCE_AUTHORITY_CHANGED');
 const result={id,...input,listingId:r.listingId,mode:'RETROSPECTIVE_CORRECTION',state:complete?'REPLAYED':'PARTIAL',reasons:complete?[]:['HISTORICAL_RS_UNAVAILABLE'],decidedAt,dataRevision:id,adjustmentId:r.adjustmentId,calendarHash:r.calendarHash,sessions,remainingStages:complete?['SCANS']:['RS_CONTEXT','SCANS']};
 await db.$executeRaw`INSERT INTO "StructureReplayResult" ("id","indicatorReceiptId","instrumentSnapshotId","profileId","strengthReplayId","evidence") VALUES (${id},${input.indicatorReceiptId},${input.instrumentSnapshotId},${input.profileId},${input.strengthReplayId??null},${canonical(result)}::jsonb) ON CONFLICT DO NOTHING`;
 const stored=await db.$queryRaw<{evidence:Prisma.JsonValue}[]>`SELECT "evidence" FROM "StructureReplayResult" WHERE "id"=${id}`;
 if(canonical(stored[0]?.evidence)!==canonical(result))throw new Error('STRUCTURE_REPLAY_CONFLICT');
 return result;
}
export async function pendingStructureReplays(db:PrismaClient){
 return db.$queryRaw<Required<StructureReplayInput>[]>`SELECT r."id" AS "strengthReplayId",r."indicatorReceiptId",r."instrumentSnapshotId",r."profileId" FROM "RelativeStrengthReplay" r LEFT JOIN "StructureReplayDispatch" d ON d."strengthReplayId"=r."id" WHERE NOT EXISTS (SELECT 1 FROM "StructureReplayResult" done WHERE done."strengthReplayId"=r."id") ORDER BY COALESCE(d."checkedAt",r."createdAt"),r."id" LIMIT 25`;
}
export async function recordStructureDispatch(db:PrismaClient,strengthReplayId:string,state:string){await db.$executeRaw`INSERT INTO "StructureReplayDispatch" ("strengthReplayId","state") VALUES (${strengthReplayId},${state}) ON CONFLICT ("strengthReplayId") DO UPDATE SET "state"=EXCLUDED."state","checkedAt"=CURRENT_TIMESTAMP`}
