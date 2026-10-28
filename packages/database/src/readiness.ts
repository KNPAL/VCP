import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {GATES,readiness,sourcePermission,validateSourceRecord,type GateProof,type SourceRecord,type Permission} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
import {evaluateLicenseBindings} from './licensing.js';
export async function persistSource(db:PrismaClient,source:SourceRecord){
 // This stores permission metadata, never the licensed dataset itself. Denials are auditable.
 validateSourceRecord(source);
 const json=canonical(source),id=createHash('sha256').update(json).digest('hex');
 await db.$executeRaw`INSERT INTO "SourceSnapshot" ("id","dataset","knownAt","evidence") VALUES (${id},${source.dataset},${utcInstant(source.knownAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 return {id,...source};
}
export async function currentSource(db:Pick<PrismaClient,'$queryRaw'>,scope:{dataset:string;provider:string;endpointOrFile:string},asOf:string){
 const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT "id","evidence" FROM "SourceSnapshot" WHERE "dataset"=${scope.dataset} AND "evidence"->>'provider'=${scope.provider} AND "evidence"->>'endpointOrFile'=${scope.endpointOrFile} AND "knownAt"<=${utcInstant(asOf)} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`;
 return rows[0]??null;
}
export async function readSourceRegistry(db:Pick<PrismaClient,'$queryRaw'>,dataset?:string,asOf=new Date().toISOString()){
 if(dataset!==undefined&&(!dataset.trim()||dataset.length>128))throw new Error('INVALID_SOURCE_DATASET');
 const rows=await db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT DISTINCT ON ("dataset","evidence"->>'provider',"evidence"->>'endpointOrFile') "id","evidence" FROM "SourceSnapshot" WHERE "knownAt"<=${utcInstant(asOf)} AND (${dataset??null}::text IS NULL OR "dataset"=${dataset??null}) ORDER BY "dataset","evidence"->>'provider',"evidence"->>'endpointOrFile',"knownAt" DESC,"id" ASC`;
 return {asOf,requestedDataset:dataset??null,state:rows.length?'RECORDED':'UNKNOWN',reason:rows.length?null:'SOURCE_MISSING',failurePolicy:'BLOCKED_DATA',items:rows.map(row=>({id:row.id,source:row.evidence,permissions:Object.fromEntries((['DOWNLOAD','STORE','DERIVE','DISPLAY','REDISTRIBUTE'] as Permission[]).map(use=>[use,sourcePermission(row.evidence,use,asOf)])),failurePolicy:'BLOCKED_DATA'})),executable:false};
}
export async function persistReadiness(db:PrismaClient,proof:Omit<GateProof,'id'>){
 if(!Object.hasOwn(GATES,proof.gate))throw new Error('INVALID_READINESS_GATE');
 if(proof.status!=='PASS'&&!proof.reason)throw new Error('READINESS_FAILURE_REASON_REQUIRED');
 if(proof.gate==='G07'&&proof.status==='PASS'&&(await evaluateLicenseBindings(db,proof.details,proof.probeAt)).status!=='PASS')throw new Error('INVALID_READINESS_PROOF: LICENSE_SOURCE_BINDINGS_REQUIRED');
 const id=createHash('sha256').update(canonical(proof)).digest('hex'),event={id,...proof};
 const evaluated=readiness([event],proof.probeAt).items.find(item=>item.gate===proof.gate)!;
 if(evaluated.reason==='INVALID_PROOF'||evaluated.reason==='PASSING_EVIDENCE_MISSING'||evaluated.reason==='PROOF_EXPIRED')throw new Error('INVALID_READINESS_PROOF');
 const json=canonical(event);await db.$executeRaw`INSERT INTO "ReadinessProof" ("id","gate","status","probeAt","sourceAt","expiresAt","evidence") VALUES (${id},${proof.gate},${proof.status},${utcInstant(proof.probeAt)},${proof.sourceAt?utcInstant(proof.sourceAt):null},${utcInstant(proof.expiresAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 return event;
}
export async function getReadiness(db:Pick<PrismaClient,'$queryRaw'>,asOf=new Date().toISOString()){
 const rows=await db.$queryRaw<{evidence:GateProof}[]>`SELECT DISTINCT ON ("gate") "evidence" FROM "ReadinessProof" WHERE "probeAt"<=${utcInstant(asOf)} ORDER BY "gate","probeAt" DESC,"id" ASC`;
 const proofs=rows.map(row=>row.evidence),license=proofs.find(proof=>proof.gate==='G07');
 if(license?.status==='PASS'){
  const checked=await evaluateLicenseBindings(db,license.details,asOf),index=proofs.indexOf(license);
  proofs[index]={...license,status:checked.status,reason:checked.reasons.join(';')||null,expiresAt:checked.status==='PASS'?new Date(Math.min(Date.parse(license.expiresAt),Date.parse(checked.validUntil))).toISOString():license.expiresAt};
 }
 return {...readiness(proofs,asOf),storedLicenseProof:license??null};
}
