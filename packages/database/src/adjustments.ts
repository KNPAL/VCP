import type {PrismaClient} from '@prisma/client';
import {parseFixed} from '@vcp/domain';
import {adjustCandles,type AdjustmentInput} from '@vcp/market-data';
import {canonical} from './indicators.js';

export async function persistAdjustment(db:PrismaClient,input:AdjustmentInput){
 const result=adjustCandles(input),evidence=canonical({source:{...input.source,actions:[...input.source.actions].sort((a,b)=>a.id.localeCompare(b.id))},result,rawRevisionIds:input.raw.map(bar=>bar.revisionId).sort()});
 return db.$transaction(async tx=>{
  const originals=await tx.candleRevision.findMany({where:{id:{in:input.raw.map(bar=>bar.revisionId)}}});
  for(const bar of input.raw){
   const stored=originals.find(row=>row.id===bar.revisionId);
   if(!stored||stored.scale!=='RAW'||stored.listingId!==input.listingId||stored.session.toISOString().slice(0,10)!==bar.session||stored.source!==bar.provider||stored.receivedAt.valueOf()!==new Date(bar.receivedAt).valueOf()||stored.finalizedAt?.valueOf()!==new Date(bar.finalizedAt!).valueOf()||stored.volume!==BigInt(bar.volume)||(['open','high','low','close'] as const).some(field=>parseFixed(stored[field].toFixed(6))!==parseFixed(bar[field])))throw new Error('RAW_REVISION_MISMATCH');
  }
  await tx.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${result.revision},${input.listingId}::uuid,${new Date(input.scaleSession)},${new Date(input.asOf)},${result.state},${evidence}::jsonb) ON CONFLICT ("id") DO NOTHING`;
  const previous=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "AdjustmentSnapshot" WHERE "id"=${result.revision}`;
  if(canonical(previous[0]?.evidence)!==evidence)throw new Error('STALE_CONFLICT: adjustment evidence differs');
  for(const bar of result.bars){
   const details=canonical(bar);
   await tx.$executeRaw`INSERT INTO "AdjustedDailyCandle" ("adjustmentId","rawRevisionId","session","open","high","low","close","volume","evidence") VALUES (${result.revision},${bar.rawRevisionId}::uuid,${new Date(bar.session)},${bar.open}::numeric,${bar.high}::numeric,${bar.low}::numeric,${bar.close}::numeric,${bar.volume}::numeric,${details}::jsonb) ON CONFLICT ("adjustmentId","session") DO NOTHING`;
  }
  return result;
 });
}
