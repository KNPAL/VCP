import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {normalizeInstrumentMaster,type MasterImport} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {persistInstrumentSnapshotTransaction} from './instruments.js';
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export async function importInstrumentMaster(db:PrismaClient,input:MasterImport){
 const asOf=new Date().toISOString(),normalized=normalizeInstrumentMaster(input,asOf),id=hash(input);
 return db.$transaction(async tx=>{
  const prior=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "InstrumentMasterImport" WHERE "id"=${id}`;if(prior[0])return prior[0].evidence;
  const snapshot=await persistInstrumentSnapshotTransaction(tx,{knownAt:input.knownAt,sourceReference:id,rows:normalized.rows});
  const evidence={id,asOf,source:input.source,tickDivisor:input.tickDivisor,inputHash:id,snapshotId:snapshot.id,status:normalized.status,counts:normalized.counts,report:normalized.report};
  await tx.$executeRaw`INSERT INTO "InstrumentMasterImport" ("id","evidence") VALUES (${id},${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`;
  const saved=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "InstrumentMasterImport" WHERE "id"=${id}`;return saved[0]!.evidence;
 },{timeout:120000});
}
