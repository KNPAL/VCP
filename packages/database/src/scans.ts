import {PrismaClient} from '@prisma/client';
import {completeScan} from '@vcp/strategy';
import type {CompletedScan,ScanOutcome,ScanEvidence} from '@vcp/strategy';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
export async function persistScan(db:PrismaClient,evidence:ScanEvidence,intended:readonly string[],outcomes:readonly ScanOutcome[]){
 if(!/^[0-9a-f-]{36}$/.test(evidence.scanId))throw new Error('INVALID_SCAN_ID');
 const scan=completeScan(evidence,intended,outcomes),json=canonical(scan),asOf=utcInstant(scan.asOf);
 await db.$executeRaw`INSERT INTO "ScanResult" ("id","asOf","configHash","dataRevision","status","evidence") VALUES (${scan.scanId}::uuid,${asOf},${scan.configHash},${scan.dataRevision},${scan.status},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 const saved=await getScan(db,scan.scanId);
 if(canonical(saved)!==json)throw new Error('STALE_CONFLICT: scan evidence is immutable');
 return saved!;
}
export async function getScan(db:PrismaClient,id:string):Promise<CompletedScan|null>{
 const rows=await db.$queryRaw<{evidence:CompletedScan}[]>`SELECT "evidence" FROM "ScanResult" WHERE "id"=${id}::uuid`;
 return rows[0]?.evidence??null;
}
export async function latestScan(db:PrismaClient):Promise<CompletedScan|null>{
 const rows=await db.$queryRaw<{evidence:CompletedScan}[]>`SELECT "evidence" FROM "ScanResult" ORDER BY "asOf" DESC,"createdAt" DESC,"id" DESC LIMIT 1`;
 return rows[0]?.evidence??null;
}
