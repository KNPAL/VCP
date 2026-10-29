import type {PrismaClient} from '@prisma/client';
import {assertCandlePermissions,assertProviderPermissions} from './data-permissions.js';
type Reader=Pick<PrismaClient,'$queryRaw'>;
export async function assertDailyExecutionDisplay(db:Reader,sourceIds:readonly string[]){
 const ids=[...new Set(sourceIds)];if(!ids.length)return;
 const rows=await db.$queryRaw<{evidence:{input?:{series?:{bars?:{revision:string}[]}}}}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "id"=ANY(${ids}::text[])`;
 if(rows.length!==ids.length||rows.some(row=>!Array.isArray(row.evidence.input?.series?.bars)||!row.evidence.input.series.bars.length))throw new Error('SOURCE_LINEAGE_MISSING');
 await assertCandlePermissions(db,rows.flatMap(row=>row.evidence.input!.series!.bars!.map(bar=>bar.revision)),['DISPLAY','DERIVE']);
}
/** Check the immutable initial and trailing stop inputs, including historical episodes. */
export async function assertPositionCandleDisplay(db:Reader,ownerId:string,isin?:string){
 const stops=await db.$queryRaw<{id:string;evidence:{sourceId?:string|null;stop?:unknown}}[]>`SELECT "id","evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND (${isin??null}::text IS NULL OR "isin"=${isin??null})`;
 if(stops.some(row=>row.evidence.stop&&!row.evidence.sourceId))throw new Error('SOURCE_LINEAGE_MISSING');
 await assertDailyExecutionDisplay(db,stops.flatMap(row=>row.evidence.sourceId?[row.evidence.sourceId]:[]));
 if(!stops.length)return;
 const stopIds=stops.map(row=>row.id);
 const quotes=await db.$queryRaw<{provider:string|null}[]>`
 SELECT "evidence"->'quote'->>'provider' AS provider FROM "ProtectiveSignal" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stopIds}::text[])
 UNION ALL SELECT "evidence"->'quote'->>'provider' FROM "PartialProfitSignal" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stopIds}::text[])
 UNION ALL SELECT "evidence"->'sources'->>'quoteProvider' FROM "PositionStatusHistory" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stopIds}::text[]) AND COALESCE("evidence"->'sources'->>'quote','')<>''`;
 for(const provider of new Set(quotes.map(row=>row.provider))){if(!provider)throw new Error('SOURCE_LINEAGE_MISSING');await assertProviderPermissions(db,'LIVE_QUOTES',provider,['DISPLAY','DERIVE'])}
 const trails=await db.$queryRaw<{evidence:{input?:{sourceRevision?:string}}}[]>`SELECT "evidence" FROM "PositionTrail" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stops.map(row=>row.id)}::text[])`;
 if(trails.some(row=>!row.evidence.input?.sourceRevision))throw new Error('SOURCE_LINEAGE_MISSING');
 const historical=await db.$queryRaw<{revision:string|null}[]>`
 SELECT "evidence"->>'dataRevision' AS revision FROM "PositionFailure" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stopIds}::text[])
 UNION ALL SELECT "evidence"->'sources'->>'adjustment' FROM "PositionStatusHistory" WHERE "ownerId"=${ownerId}::uuid AND "stopId"=ANY(${stopIds}::text[]) AND "evidence"->'sources'->>'adjustment' IS NOT NULL`;
 if(historical.some(row=>!row.revision))throw new Error('SOURCE_LINEAGE_MISSING');
 const ids=[...new Set([...trails.map(row=>row.evidence.input!.sourceRevision!),...historical.map(row=>row.revision!)])];if(!ids.length)return;
 const sources=await db.$queryRaw<{evidence:{result?:{bars?:{rawRevisionId:string}[]}}}[]>`SELECT "evidence" FROM "AdjustmentSnapshot" WHERE "id"=ANY(${ids}::text[])`;
 if(sources.length!==ids.length||sources.some(row=>!Array.isArray(row.evidence.result?.bars)||!row.evidence.result.bars.length))throw new Error('SOURCE_LINEAGE_MISSING');
 await assertCandlePermissions(db,sources.flatMap(row=>row.evidence.result!.bars!.map(bar=>bar.rawRevisionId)),['DISPLAY','DERIVE']);
}
