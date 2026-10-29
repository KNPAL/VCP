import type {PrismaClient} from '@prisma/client';
import {sourcePermission,type Permission,type SourceRecord} from '@vcp/market-data';
/** Current legal authority is independent of the historical market-data cutoff. */
export async function assertCandlePermissions(db:Pick<PrismaClient,'$queryRaw'>,revisionIds:readonly string[],operations:readonly Permission[],asOf=new Date().toISOString()){
 const ids=[...new Set(revisionIds)];if(!ids.length||ids.some(id=>!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id)))throw new Error('SOURCE_LINEAGE_MISSING');
 const raw=await db.$queryRaw<{id:string;source:string}[]>`SELECT "id","source" FROM "CandleRevision" WHERE "id"=ANY(${ids}::uuid[])`;
 if(raw.length!==ids.length)throw new Error('SOURCE_LINEAGE_MISSING');
 const sourceSnapshotIds:string[]=[];
 for(const provider of [...new Set(raw.map(row=>row.source))].sort()){
  sourceSnapshotIds.push(await assertProviderPermissions(db,'DAILY_CANDLES',provider,operations,asOf));
 }
 return {checkedAt:asOf,sourceSnapshotIds};
}

export async function assertProviderPermissions(db:Pick<PrismaClient,'$queryRaw'>,dataset:'DAILY_CANDLES'|'LIVE_QUOTES',provider:string,operations:readonly Permission[],asOf=new Date().toISOString()){
 if(typeof provider!=='string'||!provider.trim())throw new Error('SOURCE_LINEAGE_MISSING');
  const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT s."id",s."evidence" FROM "SourceSnapshot" s WHERE s."dataset"=${dataset} AND s."evidence"->>'provider'=${provider} AND s."knownAt"=(SELECT max(n."knownAt") FROM "SourceSnapshot" n WHERE n."dataset"=s."dataset" AND n."evidence"->>'provider'=s."evidence"->>'provider' AND n."evidence"->>'endpointOrFile'=s."evidence"->>'endpointOrFile' AND n."knownAt"<=${new Date(asOf)})`;
  // Provider-only lineage must never choose between conflicting endpoints.
  if(rows.length!==1)throw new Error(rows.length?'SOURCE_SCOPE_AMBIGUOUS':'SOURCE_PERMISSION_REQUIRED');
  const source=rows[0]!;
  if(operations.some(operation=>sourcePermission(source.evidence,operation,asOf).status!=='PASS'))throw new Error('SOURCE_PERMISSION_REQUIRED');
 return source.id;
}
export async function assertPlanQuoteDisplay(db:Pick<PrismaClient,'$queryRaw'>,value:unknown){
 const plan=value as {entry?:unknown;snapshotId?:unknown;valuation?:unknown;liveObservation?:{quote?:{provider?:unknown}}|null};
 if(typeof plan.snapshotId==='string')await assertPortfolioQuoteDisplay(db,plan.snapshotId);
 else if(plan.valuation)throw new Error('SOURCE_LINEAGE_MISSING');
 const quote=plan.liveObservation?.quote;
 if(!quote){if(plan.entry!==null&&plan.entry!==undefined)throw new Error('SOURCE_LINEAGE_MISSING');return}
 if(typeof quote.provider!=='string')throw new Error('SOURCE_LINEAGE_MISSING');
 await assertProviderPermissions(db,'LIVE_QUOTES',quote.provider,['DISPLAY','DERIVE']);
}
export async function assertPortfolioQuoteDisplay(db:Pick<PrismaClient,'$queryRaw'>,snapshotId:string|null){
 if(!snapshotId)return;
 const rows=await db.$queryRaw<{evidence:{quotes?:Record<string,{provider?:unknown}>}}[]>`SELECT "evidence" FROM "PortfolioRiskSnapshot" WHERE "id"=${snapshotId}`;
 if(!rows[0]?.evidence.quotes)throw new Error('SOURCE_LINEAGE_MISSING');
 const providers=new Set(Object.values(rows[0].evidence.quotes).map(quote=>quote.provider));
 for(const provider of providers){if(typeof provider!=='string')throw new Error('SOURCE_LINEAGE_MISSING');await assertProviderPermissions(db,'LIVE_QUOTES',provider,['DISPLAY','DERIVE'])}
}
