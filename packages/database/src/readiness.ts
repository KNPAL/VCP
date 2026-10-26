import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {GATES,readiness,sourcePermission,type GateProof,type SourceRecord} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
export async function persistSource(db:PrismaClient,source:SourceRecord){
 sourcePermission(source,'STORE',source.knownAt);
 const json=canonical(source),id=createHash('sha256').update(json).digest('hex');
 await db.$executeRaw`INSERT INTO "SourceSnapshot" ("id","dataset","knownAt","evidence") VALUES (${id},${source.dataset},${utcInstant(source.knownAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 return {id,...source};
}
export async function persistReadiness(db:PrismaClient,proof:Omit<GateProof,'id'>){
 if(!Object.hasOwn(GATES,proof.gate))throw new Error('INVALID_READINESS_GATE');
 if(proof.status!=='PASS'&&!proof.reason)throw new Error('READINESS_FAILURE_REASON_REQUIRED');
 const id=createHash('sha256').update(canonical(proof)).digest('hex'),event={id,...proof};
 const evaluated=readiness([event],proof.probeAt).items.find(item=>item.gate===proof.gate)!;
 if(evaluated.reason==='INVALID_PROOF'||evaluated.reason==='PASSING_EVIDENCE_MISSING'||evaluated.reason==='PROOF_EXPIRED')throw new Error('INVALID_READINESS_PROOF');
 const json=canonical(event);await db.$executeRaw`INSERT INTO "ReadinessProof" ("id","gate","status","probeAt","sourceAt","expiresAt","evidence") VALUES (${id},${proof.gate},${proof.status},${utcInstant(proof.probeAt)},${proof.sourceAt?utcInstant(proof.sourceAt):null},${utcInstant(proof.expiresAt)},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 return event;
}
export async function getReadiness(db:Pick<PrismaClient,'$queryRaw'>,asOf=new Date().toISOString()){
 const rows=await db.$queryRaw<{evidence:GateProof}[]>`SELECT DISTINCT ON ("gate") "evidence" FROM "ReadinessProof" WHERE "probeAt"<=${utcInstant(asOf)} ORDER BY "gate","probeAt" DESC,"id" ASC`;
 return readiness(rows.map(row=>row.evidence),asOf);
}
