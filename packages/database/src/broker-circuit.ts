import type {PrismaClient,Prisma} from '@prisma/client';
import type {BrokerAttempt,BrokerFailure} from '@vcp/market-data';
import {utcInstant} from '@vcp/domain';
const account=(key:string)=>{if(!/^[0-9a-f]{64}$/.test(key))throw new Error('INVALID_BROKER_ACCOUNT_KEY')};
/** Internal authentication adapter only: restoration requires a fresh verified session revision. */
export async function restoreBrokerCircuit(db:PrismaClient,key:string,proof:{sessionRevision:string;authenticated:boolean;staticIpVerified:boolean;verifiedAt:string;expiresAt:string},now=new Date().toISOString(),persist?:(tx:Prisma.TransactionClient)=>Promise<void>,beforeRestore?:(tx:Prisma.TransactionClient)=>Promise<void>){
 account(key);
 if(!proof.authenticated||!proof.staticIpVerified||utcInstant(proof.verifiedAt)>utcInstant(now)||utcInstant(proof.expiresAt)<=utcInstant(now)||utcInstant(now).valueOf()-utcInstant(proof.verifiedAt).valueOf()>60000)throw new Error('BROKER_AUTH_PROOF_INVALID');
 await db.$transaction(async tx=>{
  if(beforeRestore)await beforeRestore(tx);
  const fresh=await tx.$executeRaw`INSERT INTO "BrokerSessionEvidence" ("accountKey","sessionRevision","verifiedAt","expiresAt") VALUES (${key},${proof.sessionRevision}::uuid,${new Date(proof.verifiedAt)},${new Date(proof.expiresAt)}) ON CONFLICT DO NOTHING`;
  if(fresh!==1)throw new Error('BROKER_FRESH_SESSION_REQUIRED');
  const count=await tx.$executeRaw`INSERT INTO "BrokerCircuit" ("accountKey","sessionRevision","open","expiresAt","reason","verifiedAt") VALUES (${key},${proof.sessionRevision}::uuid,false,${new Date(proof.expiresAt)},NULL,${new Date(proof.verifiedAt)}) ON CONFLICT ("accountKey") DO UPDATE SET "sessionRevision"=EXCLUDED."sessionRevision","open"=false,"expiresAt"=EXCLUDED."expiresAt","reason"=NULL,"verifiedAt"=EXCLUDED."verifiedAt","updatedAt"=CURRENT_TIMESTAMP WHERE "BrokerCircuit"."verifiedAt"<EXCLUDED."verifiedAt"`;
  if(count!==1)throw new Error('BROKER_FRESH_SESSION_REQUIRED');
  if(persist)await persist(tx);
 });
}
export function brokerCircuitStore(db:PrismaClient,key:string){
 account(key);
 return {
  readCircuit:async()=>{const rows=await db.$queryRaw<{sessionRevision:string;open:boolean;expiresAt:Date}[]>`SELECT "sessionRevision","open","expiresAt" FROM "BrokerCircuit" WHERE "accountKey"=${key}`;return rows[0]?{...rows[0],expiresAt:rows[0].expiresAt.toISOString()}:null},
  openCircuit:async(sessionRevision:string,reason:BrokerFailure)=>{await db.$executeRaw`UPDATE "BrokerCircuit" SET "open"=true,"reason"=${reason},"updatedAt"=CURRENT_TIMESTAMP WHERE "accountKey"=${key} AND "sessionRevision"=${sessionRevision}::uuid`},
  audit:async(attempt:BrokerAttempt)=>{await db.$executeRaw`INSERT INTO "BrokerRequestAttempt" ("accountKey","requestId","attempt","at","reason","httpStatus","retryInMs") VALUES (${key},${attempt.requestId}::uuid,${attempt.attempt},${new Date(attempt.at)},${attempt.reason},${attempt.httpStatus},${attempt.retryInMs})`},
 };
}
