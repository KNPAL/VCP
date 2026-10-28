import type {PrismaClient} from '@prisma/client';
import {sourcePermission,type SourceRecord} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
export const LICENSE_SOURCE_ROLES=['INSTRUMENT_MASTER','UNIVERSE','CALENDAR','DAILY_CANDLES','LIVE_QUOTES','CORPORATE_ACTIONS','BENCHMARK','SECTORS','SURVEILLANCE'] as const;
export async function evaluateLicenseBindings(db:Pick<PrismaClient,'$queryRaw'>,details:unknown,asOf:string){
 const bindings=(details&&typeof details==='object'&&!Array.isArray(details)?(details as Record<string,unknown>)['sourceBindings']:null);
 const unavailable=(reason:string)=>({status:'UNKNOWN' as const,reasons:[reason],validUntil:asOf});
 if(!Array.isArray(bindings)||bindings.length!==LICENSE_SOURCE_ROLES.length)return unavailable('LICENSE_SOURCE_BINDINGS_REQUIRED');
 const roles=new Set<string>(),ids:string[]=[];
 for(const value of bindings){if(!value||typeof value!=='object'||Array.isArray(value))return unavailable('LICENSE_SOURCE_BINDINGS_INVALID');const row=value as Record<string,unknown>;
  if(typeof row['role']!=='string'||!LICENSE_SOURCE_ROLES.includes(row['role'] as typeof LICENSE_SOURCE_ROLES[number])||roles.has(row['role'])||typeof row['sourceSnapshotId']!=='string'||!/^[a-f0-9]{64}$/.test(row['sourceSnapshotId']))return unavailable('LICENSE_SOURCE_BINDINGS_INVALID');
  roles.add(row['role']);ids.push(row['sourceSnapshotId']);
 }
 if(new Set(ids).size!==ids.length)return unavailable('LICENSE_SOURCE_BINDINGS_INVALID');
 const reasons:string[]=[],deadlines:number[]=[];let denied=false;
 for(const binding of bindings as {role:string;sourceSnapshotId:string}[]){
  const rows=await db.$queryRaw<{id:string;evidence:SourceRecord;currentId:string|null}[]>`SELECT s."id",s."evidence",(SELECT n."id" FROM "SourceSnapshot" n WHERE n."dataset"=s."dataset" AND n."evidence"->>'provider'=s."evidence"->>'provider' AND n."evidence"->>'endpointOrFile'=s."evidence"->>'endpointOrFile' AND n."knownAt"<=${utcInstant(asOf)} ORDER BY n."knownAt" DESC,n."id" ASC LIMIT 1) AS "currentId" FROM "SourceSnapshot" s WHERE s."id"=${binding.sourceSnapshotId}`;
  const row=rows[0];if(!row||row.currentId!==row.id){reasons.push(binding.role+':SOURCE_MISSING_OR_SUPERSEDED');continue}
  if(row.evidence.dataset!==binding.role){reasons.push(binding.role+':SOURCE_DATASET_MISMATCH');continue}
  const operations=['STORE','DERIVE','DISPLAY',...(['DAILY_CANDLES','LIVE_QUOTES'].includes(binding.role)?['DOWNLOAD']:[])] as const;
  for(const operation of operations){const result=sourcePermission(row.evidence,operation as 'STORE'|'DERIVE'|'DISPLAY'|'DOWNLOAD',asOf);denied ||= result.status==='FAIL';reasons.push(...result.reasons.map(reason=>binding.role+':'+operation+':'+reason))}
  const s=row.evidence;deadlines.push(Date.parse(s.validUntil),Date.parse(s.asOf)+s.maximumAgeMs,Date.parse(s.lastVerified)+s.maximumAgeMs);
 }
 return {status:denied?'FAIL' as const:reasons.length?'UNKNOWN' as const:'PASS' as const,reasons:[...new Set(reasons)],validUntil:reasons.length?asOf:new Date(Math.min(...deadlines)).toISOString()};
}
