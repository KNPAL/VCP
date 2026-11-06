import type {PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {sourcePermission,type SourceRecord,type Permission} from '@vcp/market-data';
import {canonical} from './indicators.js';

type Scope=Pick<SourceRecord,'dataset'|'provider'|'endpointOrFile'>;
// Registry writers take the exclusive provider lock. Dataset writers hold a shared lock
// through commit so a new endpoint or revocation cannot race the last permission read.
export async function lockProviderAuthority(db:Pick<PrismaClient,'$executeRaw'>,dataset:string,providers:readonly string[],mode:'READ'|'WRITE'){
 for(const provider of [...new Set(providers)].sort()){
  const key=JSON.stringify([dataset,provider]);
  if(mode==='WRITE')await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  else await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`;
 }
}
export async function lockSourceScope(db:Pick<PrismaClient,'$executeRaw'>,scope:Scope){
 const key=JSON.stringify([scope.dataset,scope.provider,scope.endpointOrFile]);
 await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
export async function currentSource(db:Pick<PrismaClient,'$queryRaw'>,scope:{dataset:string;provider:string;endpointOrFile:string},asOf:string){
 const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT "id","evidence" FROM "SourceSnapshot" WHERE "dataset"=${scope.dataset} AND "evidence"->>'provider'=${scope.provider} AND "evidence"->>'endpointOrFile'=${scope.endpointOrFile} AND "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 2`;
 const [latest,previous]=rows;
 if(previous&&latest&&utcInstant(previous.evidence.knownAt).getTime()===utcInstant(latest.evidence.knownAt).getTime())return null;
 return latest??null;
}

export async function registeredSourceReasons(db:Pick<PrismaClient,'$queryRaw'>,source:SourceRecord,uses:readonly Permission[],asOf:string){
 const current=await currentSource(db,source,asOf);
 if(!current||canonical(current.evidence)!==canonical(source))return ['SOURCE_MISSING_OR_SUPERSEDED'];
 return uses.flatMap(use=>sourcePermission(current.evidence,use,asOf).reasons);
}
export async function assertRegisteredSourceIds(db:Pick<PrismaClient,'$queryRaw'>,dataset:string,sourceIds:readonly (string|undefined)[],uses:readonly Permission[]){
 const ids=[...new Set(sourceIds)];if(!ids.length)return;
 if(ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw new Error('SOURCE_LINEAGE_MISSING');
 const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT id,evidence FROM "SourceSnapshot" WHERE id=ANY(${ids as string[]}::text[]) AND dataset=${dataset}`;
 if(rows.length!==ids.length)throw new Error('SOURCE_PERMISSION_REQUIRED');
 for(const row of rows)if((await registeredSourceReasons(db,row.evidence,uses,new Date().toISOString())).length)throw new Error('SOURCE_PERMISSION_REQUIRED');
}
