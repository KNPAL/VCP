import type {PrismaClient} from '@prisma/client';
import {sourcePermission,type Permission,type SourceRecord} from '@vcp/market-data';
/** Current legal authority is independent of the historical market-data cutoff. */
export async function assertCandlePermissions(db:Pick<PrismaClient,'$queryRaw'>,revisionIds:readonly string[],operations:readonly Permission[],asOf=new Date().toISOString()){
 const ids=[...new Set(revisionIds)];if(!ids.length||ids.some(id=>!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id)))throw new Error('SOURCE_LINEAGE_MISSING');
 const raw=await db.$queryRaw<{id:string;source:string}[]>`SELECT "id","source" FROM "CandleRevision" WHERE "id"=ANY(${ids}::uuid[])`;
 if(raw.length!==ids.length)throw new Error('SOURCE_LINEAGE_MISSING');
 const sourceSnapshotIds:string[]=[];
 for(const provider of [...new Set(raw.map(row=>row.source))].sort()){
  const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT DISTINCT ON ("evidence"->>'endpointOrFile') "id","evidence" FROM "SourceSnapshot" WHERE "dataset"='DAILY_CANDLES' AND "evidence"->>'provider'=${provider} AND "knownAt"<=${new Date(asOf)} ORDER BY "evidence"->>'endpointOrFile',"knownAt" DESC,"id" ASC`;
  // Legacy candle lineage names only the provider. Never choose between conflicting endpoints.
  if(rows.length!==1)throw new Error(rows.length?'SOURCE_SCOPE_AMBIGUOUS':'SOURCE_PERMISSION_REQUIRED');
  const source=rows[0]!;
  if(operations.some(operation=>sourcePermission(source.evidence,operation,asOf).status!=='PASS'))throw new Error('SOURCE_PERMISSION_REQUIRED');
  sourceSnapshotIds.push(source.id);
 }
 return {checkedAt:asOf,sourceSnapshotIds};
}
