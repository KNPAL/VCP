import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {readiness,type InstrumentSnapshot,type UniverseSnapshot,type GateProof} from '@vcp/market-data';
import {ST_VCP_4_0,PROFILE_VERSION,configurationHash} from '@vcp/strategy';
import {canonical} from './indicators.js';
import type {StrengthReplayInput} from './rs-replay.js';

export async function discoverStrengthReplayContext(db:PrismaClient,receiptId:string){
 if(!/^[0-9a-f]{64}$/.test(receiptId))throw new Error('INVALID_REPLAY_IDENTITY');
 const existing=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "StrengthReplayPlan" WHERE "indicatorReceiptId"=${receiptId} ORDER BY "createdAt","id" LIMIT 1`;
 if(existing[0])return {state:'PLANNED' as const,id:existing[0].id,reason:null};
 const receipts=await db.$queryRaw<{evidence:{listingId:string;adjustmentId:string;from:string;to:string;state:string}}[]>`SELECT "evidence" FROM "IndicatorReplayReceipt" WHERE "id"=${receiptId}`;
 const r=receipts[0]?.evidence;if(!r||r.state!=='INDICATORS_REPLAYED')throw new Error('INDICATOR_REPLAY_REQUIRED');
 const evaluatedAt=new Date().toISOString(),now=new Date(evaluatedAt);
 async function waiting(reason:string){
  await db.$executeRaw`INSERT INTO "ReplayContextDiscovery" ("indicatorReceiptId","state","reason") VALUES (${receiptId},'WAITING',${reason}) ON CONFLICT ("indicatorReceiptId") DO UPDATE SET "state"='WAITING',"reason"=EXCLUDED."reason","checkedAt"=CURRENT_TIMESTAMP`;
  return {state:'WAITING' as const,id:null,reason};
 }
 const mappings=await db.$queryRaw<{id:string;evidence:InstrumentSnapshot}[]>`SELECT "id","evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${now} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const mapping=mappings[0];if(!mapping)return waiting('RS_MAPPING_UNAVAILABLE');
 const target=mapping.evidence.rows.filter(row=>row.listingId===r.listingId&&row.enabled&&row.verified&&row.instrumentType==='EQUITY'&&row.validFrom<=r.from&&(row.validTo===null||row.validTo>r.to)&&((row.exchange==='NSE'&&row.series==='EQ')||(row.exchange==='BSE'&&row.series==='CASH')));
 if(target.length!==1)return waiting('RS_TARGET_MAPPING_UNAVAILABLE');
 const isin=target[0]!.isin;
 const universes=await db.$queryRaw<{id:string;evidence:UniverseSnapshot}[]>`SELECT "id","evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${now} AND "evidence"->>'universe'='NIFTY_500' AND "evidence"->>'effectiveFrom'<=${r.from} AND ("evidence"->>'effectiveTo' IS NULL OR "evidence"->>'effectiveTo'>${r.to}) ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const universe=universes[0];
 if(!universe||!universe.evidence.historicalConstituentsVerified||!universe.evidence.isins.includes(isin))return waiting('RS_HISTORICAL_UNIVERSE_UNAVAILABLE');
 const proofs=await db.$queryRaw<{id:string;evidence:GateProof}[]>`SELECT "id","evidence" FROM "ReadinessProof" WHERE "gate"='G04' AND "probeAt"<=${now} ORDER BY "probeAt" DESC,"id" LIMIT 1`;
 const proof=proofs[0],details=proof?.evidence.details as {identifier?:string;adjustmentId?:string}|undefined;
 if(!proof||readiness([proof.evidence],evaluatedAt).items.find(p=>p.gate==='G04')?.status!=='PASS'||details?.identifier!=='NIFTY_500_PRICE'||!details.adjustmentId||!/^[0-9a-f]{64}$/.test(details.adjustmentId))return waiting('RS_BENCHMARK_PROOF_UNAVAILABLE');
 const profile=await db.strategyProfile.findUnique({where:{version:PROFILE_VERSION}});
 if(!profile||profile.createdAt>now||configurationHash(profile.configuration)!==configurationHash(ST_VCP_4_0))return waiting('RS_PROFILE_UNAVAILABLE');
 const members=mapping.evidence.rows.filter(row=>universe.evidence.isins.includes(row.isin)).map(row=>row.listingId);
 const adjustments=await db.$queryRaw<{id:string;listingId:string;state:string}[]>`SELECT DISTINCT ON ("listingId") "id","listingId","state" FROM "AdjustmentSnapshot" WHERE "asOf"<=${now} AND "listingId"=ANY(${members}::uuid[]) ORDER BY "listingId","asOf" DESC,"id"`;
 const memberAdjustmentIds=Object.fromEntries(adjustments.filter(a=>a.state==='KNOWN').map(a=>[a.listingId,a.id]));
 memberAdjustmentIds[r.listingId]=r.adjustmentId;
 const input:StrengthReplayInput={indicatorReceiptId:receiptId,instrumentSnapshotId:mapping.id,profileId:profile.id,universeSnapshotId:universe.id,benchmarkProofId:proof.id,benchmarkAdjustmentId:details.adjustmentId,memberAdjustmentIds,evaluatedAt};
 const id=createHash('sha256').update(canonical(input)).digest('hex');
 await db.$executeRaw`INSERT INTO "StrengthReplayPlan" ("id","indicatorReceiptId","templateId","evidence") VALUES (${id},${receiptId},NULL,${canonical(input)}::jsonb) ON CONFLICT DO NOTHING`;
 const stored=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "StrengthReplayPlan" WHERE "indicatorReceiptId"=${receiptId} AND "templateId" IS NULL AND "dependencyKey" IS NULL`;
 await db.$executeRaw`INSERT INTO "ReplayContextDiscovery" ("indicatorReceiptId","state","reason") VALUES (${receiptId},'PLANNED',NULL) ON CONFLICT ("indicatorReceiptId") DO UPDATE SET "state"='PLANNED',"reason"=NULL,"checkedAt"=CURRENT_TIMESTAMP`;
 return {state:'PLANNED' as const,id:stored[0]!.id,reason:null};
}
export async function discoverPendingReplayContexts(db:PrismaClient){
 const pending=await db.$queryRaw<{id:string}[]>`SELECT i."id" FROM "IndicatorReplayReceipt" i LEFT JOIN "ReplayContextDiscovery" d ON d."indicatorReceiptId"=i."id" WHERE NOT EXISTS (SELECT 1 FROM "StrengthReplayPlan" p WHERE p."indicatorReceiptId"=i."id") AND NOT EXISTS (SELECT 1 FROM "RelativeStrengthReplay" r WHERE r."indicatorReceiptId"=i."id") ORDER BY COALESCE(d."checkedAt",i."createdAt"),i."id" LIMIT 25`;
 for(const row of pending)await discoverStrengthReplayContext(db,row.id);
 return {checked:pending.length};
}
