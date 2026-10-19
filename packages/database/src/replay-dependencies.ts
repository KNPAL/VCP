import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {readiness,type GateProof,type InstrumentSnapshot,type UniverseSnapshot} from '@vcp/market-data';
import {canonical} from './indicators.js';
import type {StrengthReplayResult,StrengthReplayInput} from './rs-replay.js';

/** Re-evaluate immutable dependency references; never change original evidence. */
export async function refreshReplayDependencies(db:PrismaClient,receiptId:string|null=null){
 const sources=await db.$queryRaw<{id:string;evidence:StrengthReplayResult}[]>`
 SELECT latest."id",latest."evidence" FROM (SELECT DISTINCT ON ("indicatorReceiptId") * FROM "RelativeStrengthReplay" WHERE (${receiptId}::text IS NULL OR "indicatorReceiptId"=${receiptId}) ORDER BY "indicatorReceiptId","createdAt" DESC,"id" DESC) latest
 LEFT JOIN "ReplayDependencyCheck" d ON d."indicatorReceiptId"=latest."indicatorReceiptId"
 ORDER BY COALESCE(d."checkedAt",latest."createdAt"),latest."id" LIMIT 25`;
 let planned=0;
 for(const source of sources){
  const previous=source.evidence.input,evaluatedAt=new Date().toISOString(),now=new Date(evaluatedAt);
  async function record(reason:string|null){await db.$executeRaw`INSERT INTO "ReplayDependencyCheck" ("indicatorReceiptId","reason") VALUES (${previous.indicatorReceiptId},${reason}) ON CONFLICT ("indicatorReceiptId") DO UPDATE SET "reason"=EXCLUDED."reason","checkedAt"=CURRENT_TIMESTAMP`}
  const mappings=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${previous.instrumentSnapshotId}`;
  const universes=await db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "id"=${previous.universeSnapshotId}`;
  const mapping=mappings[0]?.evidence,universe=universes[0]?.evidence;
  if(!mapping||!universe){await record('RS_DEPENDENCY_CONTEXT_UNAVAILABLE');continue}
  const members=[...new Set(mapping.rows.filter(row=>universe.isins.includes(row.isin)).map(row=>row.listingId))];
  const latest=await db.$queryRaw<{id:string;listingId:string;state:string}[]>`SELECT DISTINCT ON ("listingId") "id","listingId","state" FROM "AdjustmentSnapshot" WHERE "asOf"<=${now} AND "listingId"=ANY(${members}::uuid[]) ORDER BY "listingId","asOf" DESC,"id"`;
  if(latest.some(row=>row.listingId!==source.evidence.listingId&&row.state!=='KNOWN')){await record('RS_DEPENDENCY_ADJUSTMENT_UNAVAILABLE');continue}
  const memberAdjustmentIds=Object.fromEntries(latest.filter(row=>row.state==='KNOWN').map(row=>[row.listingId,row.id]));
  // Own candles remain pinned to this receipt; a target correction has a new receipt.
  memberAdjustmentIds[source.evidence.listingId]=previous.memberAdjustmentIds[source.evidence.listingId]!;
  const proofs=await db.$queryRaw<{id:string;evidence:GateProof}[]>`SELECT "id","evidence" FROM "ReadinessProof" WHERE "gate"='G04' AND "probeAt"<=${now} ORDER BY "probeAt" DESC,"id" LIMIT 1`;
  const proof=proofs[0],details=proof?.evidence.details as {identifier?:string;adjustmentId?:string}|undefined;
  if(!proof||readiness([proof.evidence],evaluatedAt).items.find(p=>p.gate==='G04')?.status!=='PASS'||details?.identifier!=='NIFTY_500_PRICE'||!details.adjustmentId||!/^[0-9a-f]{64}$/.test(details.adjustmentId)){await record('RS_DEPENDENCY_BENCHMARK_UNAVAILABLE');continue}
  const benchmarks=await db.$queryRaw<{id:string;listingId:string;state:string}[]>`SELECT "id","listingId","state" FROM "AdjustmentSnapshot" WHERE "id"=${details.adjustmentId} AND "asOf"<=${now}`;
  const benchmark=benchmarks[0];if(!benchmark||benchmark.state!=='KNOWN'){await record('RS_DEPENDENCY_BENCHMARK_UNAVAILABLE');continue}
  const oldBenchmark=await db.$queryRaw<{listingId:string}[]>`SELECT "listingId" FROM "AdjustmentSnapshot" WHERE "id"=${previous.benchmarkAdjustmentId}`;
  if(oldBenchmark[0]?.listingId!==benchmark.listingId){await record('RS_DEPENDENCY_BENCHMARK_IDENTITY_CHANGED');continue}
  const newestBenchmark=await db.$queryRaw<{id:string}[]>`SELECT "id" FROM "AdjustmentSnapshot" WHERE "listingId"=${benchmark.listingId}::uuid AND "asOf"<=${now} ORDER BY "asOf" DESC,"id" LIMIT 1`;
  if(newestBenchmark[0]?.id!==benchmark.id){await record('RS_DEPENDENCY_BENCHMARK_PROOF_STALE');continue}
  if(canonical(memberAdjustmentIds)===canonical(previous.memberAdjustmentIds)&&benchmark.id===previous.benchmarkAdjustmentId){await record(null);continue}
  const input:StrengthReplayInput={...previous,memberAdjustmentIds,benchmarkAdjustmentId:benchmark.id,benchmarkProofId:proof.id,evaluatedAt};
  const {evaluatedAt:ignored,...references}=input;void ignored;
  const dependencyKey=createHash('sha256').update(canonical(references)).digest('hex');
  const id=createHash('sha256').update(canonical(input)).digest('hex');
  await db.$executeRaw`INSERT INTO "StrengthReplayPlan" ("id","indicatorReceiptId","templateId","dependencyKey","sourceReplayId","evidence") VALUES (${id},${previous.indicatorReceiptId},NULL,${dependencyKey},${source.id},${canonical(input)}::jsonb) ON CONFLICT DO NOTHING`;
  await record(null);planned++;
 }
 return {checked:sources.length,planned};
}
