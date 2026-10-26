import type {PrismaClient} from '@prisma/client';
import {canonicalListings,universeAt,type InstrumentSnapshot,type UniverseSnapshot} from '@vcp/market-data';
import type {CompletedScan} from '@vcp/strategy';
import {getReadiness} from './readiness.js';
import {syncJobs} from './sync-progress.js';
import {eodScanProgress} from './eod-scan.js';
export async function readBrokerHealth(db:Pick<PrismaClient,'$queryRaw'>,accountKey?:string){
 const asOf=new Date().toISOString(),readiness=await getReadiness(db,asOf),gates=readiness.items.filter(g=>['G01','G07'].includes(g.gate));
 const unavailable={asOf,state:'NOT_CONFIGURED',authenticated:false,historyReady:false,sourceAt:null,validUntil:null,reasons:['BROKER_ACCOUNT_NOT_CONFIGURED'],gates,executable:false};
 if(!accountKey)return unavailable;
 if(!/^[a-f0-9]{64}$/.test(accountKey))throw new Error('INVALID_BROKER_ACCOUNT_KEY');
 const rows=await db.$queryRaw<{open:boolean;expiresAt:Date;verifiedAt:Date;credentialPresent:boolean}[]>`SELECT c."open",c."expiresAt",c."verifiedAt",EXISTS(SELECT 1 FROM "BrokerCredential" b WHERE b."accountKey"=c."accountKey" AND b."sessionRevision"=c."sessionRevision" AND b."expiresAt"=c."expiresAt") AS "credentialPresent" FROM "BrokerCircuit" c WHERE c."accountKey"=${accountKey}`;
 const row=rows[0],now=Date.parse(asOf),authenticated=!!row&&!row.open&&row.expiresAt.valueOf()>now&&row.verifiedAt.valueOf()<=now&&row.credentialPresent;
 const reasons=[...(!row?['BROKER_SESSION_MISSING']:row.open?['BROKER_CIRCUIT_OPEN']:row.expiresAt.valueOf()<=now?['BROKER_SESSION_EXPIRED']:row.verifiedAt.valueOf()>now?['BROKER_PROOF_FROM_FUTURE']:!row.credentialPresent?['BROKER_CREDENTIAL_MISSING']:[]),...gates.filter(g=>g.status!=='PASS').map(g=>g.gate+':'+(g.reason??g.failure))];
 return {asOf,state:authenticated?'AUTHENTICATED':row?.expiresAt&&row.expiresAt.valueOf()<=now?'EXPIRED':'UNAVAILABLE',authenticated,historyReady:authenticated&&gates.every(g=>g.status==='PASS'),sourceAt:row?.verifiedAt.toISOString()??null,validUntil:row?new Date(Math.min(row.expiresAt.valueOf(),...gates.flatMap(g=>g.proof?[Date.parse(g.proof.expiresAt)]:[]))).toISOString():null,reasons,gates,executable:false};
}
/** Read stored evidence only. This never dispatches a download or mutates scan state. */
export async function readDataHealth(db:PrismaClient){
 const asOf=new Date().toISOString(),at=new Date(asOf);
 const [universes,instruments,scans,plans,readiness,jobs]=await Promise.all([
 db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`,
 db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" ASC LIMIT 1`,
 db.$queryRaw<{evidence:CompletedScan}[]>`SELECT "evidence" FROM "ScanResult" WHERE "asOf"<=${at} ORDER BY "asOf" DESC,"createdAt" DESC,"id" DESC LIMIT 1`,
 db.$queryRaw<{id:string}[]>`SELECT "id" FROM "EodScanPlan" WHERE "createdAt"<=${at} AND "evidence"->'request'->>'asOf'<=${asOf} ORDER BY "evidence"->'request'->>'asOf' DESC,"createdAt" DESC,"id" LIMIT 1`,
 getReadiness(db,asOf),syncJobs(db,{limit:50})]);
 const universe=universeAt(universes.map(r=>r.evidence),asOf),source=instruments[0]?.evidence,canonical=canonicalListings(source?[source]:[],universe.members,asOf),progress=plans[0]?await eodScanProgress(db,plans[0].id):null,scan=scans[0]?.evidence;
 const safe=(r:NonNullable<typeof source>['rows'][number])=>({listingId:r.listingId,symbol:r.symbol,exchange:r.exchange,series:r.series,instrumentType:r.instrumentType,provider:r.provider,verified:r.verified,enabled:r.enabled});
 return {asOf,executable:false,universe:{...universe,intended:universe.members.length},instrumentRevision:source?.id??null,instrumentSourceAt:source?.knownAt??null,members:canonical.map(r=>({isin:r.isin,status:r.status,reason:r.reason,primary:r.primary?safe(r.primary):null,otherListings:r.otherListings.map(safe)})),scan:scan?{scanId:scan.scanId,asOf:scan.asOf,counts:scan.counts,status:scan.status,dataRevision:scan.dataRevision}:null,progress:progress?{scanId:progress.scanId,asOf:progress.request.asOf,intended:progress.intended,processed:progress.completed,finished:progress.result!==null}:null,readiness,jobs};
}
