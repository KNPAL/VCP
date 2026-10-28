import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {utcInstant} from '@vcp/domain';
import {canonicalListings,sourcePermission,surveillance,type InstrumentSnapshot,type SourceRecord} from '@vcp/market-data';
import {canonical} from './indicators.js';
export type SurveillanceEvidence={listingId:string;mappingRevision:string;source:SourceRecord;restrictions:NonNullable<Parameters<typeof surveillance>[0]>};
type Reader=Pick<PrismaClient,'$queryRaw'>;
function validate(value:SurveillanceEvidence){
 if(!value||!/^[a-f0-9-]{36}$/.test(value.listingId)||!value.mappingRevision||!value.source||!value.restrictions)throw new Error('INVALID_SURVEILLANCE');
 const r=value.restrictions;
 if(typeof r.verified!=='boolean'||[r.asm,r.gsm,r.esm,r.cashTradable].some(v=>v!==null&&typeof v!=='boolean')||[r.lowerBand,r.upperBand].some(v=>v!==null&&typeof v!=='string'))throw new Error('INVALID_SURVEILLANCE');
 if(utcInstant(r.sourceAt)>utcInstant(r.knownAt)||utcInstant(r.validUntil)<=utcInstant(r.knownAt)||utcInstant(value.source.knownAt)>utcInstant(r.knownAt))throw new Error('INVALID_SURVEILLANCE_CHRONOLOGY');
 surveillance(r,r.knownAt);return value;
}
export async function persistSurveillance(db:PrismaClient,input:SurveillanceEvidence){
 const evidence=structuredClone(validate(input)),at=evidence.restrictions.knownAt;
 if(utcInstant(at)>new Date())throw new Error('SURVEILLANCE_NOT_YET_KNOWN');
 if(sourcePermission(evidence.source,'STORE',at).status!=='PASS')throw new Error('SURVEILLANCE_STORAGE_DENIED');
 const rows=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${evidence.mappingRevision} AND "knownAt"<=${utcInstant(at)} LIMIT 1`;
 const mapping=rows[0]?.evidence,isin=mapping?.rows.find(row=>row.listingId===evidence.listingId)?.isin;
 if(!isin||canonicalListings(mapping?[mapping]:[],[isin],at)[0]?.primary?.listingId!==evidence.listingId)throw new Error('SURVEILLANCE_MAPPING_MISMATCH');
 const json=canonical(evidence),id=createHash('sha256').update(json).digest('hex');
 await db.$executeRaw`INSERT INTO "SurveillanceSnapshot" ("id","listingId","knownAt","evidence") VALUES (${id},${evidence.listingId}::uuid,${utcInstant(at)},${json}::jsonb) ON CONFLICT DO NOTHING`;
 return {id,listingId:evidence.listingId,executable:false};
}
export async function readSurveillance(db:Reader,listingId:string,requestedAsOf?:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(listingId))throw new Error('INVALID_LISTING_ID');
 const cutoff=requestedAsOf??(await db.$queryRaw<{cutoff:string}[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff`)[0]!.cutoff;
 const asOf=(requestedAsOf?utcInstant(requestedAsOf):new Date(cutoff)).toISOString(),at=utcInstant(asOf),rows=await db.$queryRaw<{id:string;evidence:SurveillanceEvidence}[]>`SELECT "id","evidence" FROM "SurveillanceSnapshot" WHERE "listingId"=${listingId}::uuid AND "knownAt"<=${cutoff}::timestamptz AND "recordedAt"<=${cutoff}::timestamptz ORDER BY "knownAt" DESC,"recordedAt" DESC,"id" LIMIT 1`;
 const row=rows[0],base={listingId,asOf,revision:row?.id??null,lowerBand:null as string|null,upperBand:null as string|null,executable:false};
 if(!row)return {...base,status:'UNKNOWN' as const,reasons:['SURVEILLANCE_MISSING'],validUntil:asOf};
 const evidence=validate(row.evidence),result=surveillance(evidence.restrictions,asOf),rights=['DERIVE','DISPLAY'].flatMap(op=>sourcePermission(evidence.source,op as 'DERIVE'|'DISPLAY',asOf).reasons);
 const mappings=await db.$queryRaw<{id:string;evidence:InstrumentSnapshot}[]>`SELECT "id","evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const mapping=mappings[0],isin=mapping?.evidence.rows.find(r=>r.listingId===listingId)?.isin;
 const matched=mapping?.id===evidence.mappingRevision&&!!isin&&canonicalListings([mapping.evidence],[isin],asOf)[0]?.primary?.listingId===listingId;
 const reasons=[...new Set([...result.reasons,...rights,...(!matched?['SURVEILLANCE_MAPPING_CHANGED']:[])])];
 const status:'PASS'|'FAIL'|'UNKNOWN'=rights.length||!matched?'UNKNOWN':result.status==='PASS'?'PASS':result.status==='FAIL'?'FAIL':'UNKNOWN';
 const validUntil=new Date(Math.min(Date.parse(evidence.restrictions.validUntil),Date.parse(evidence.source.validUntil),Date.parse(evidence.source.asOf)+evidence.source.maximumAgeMs,Date.parse(evidence.source.lastVerified)+evidence.source.maximumAgeMs)).toISOString();
 return {...base,status,reasons,validUntil,...(!rights.length&&matched?{lowerBand:evidence.restrictions.lowerBand,upperBand:evidence.restrictions.upperBand}:{})};
}
