import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {PrismaClient} from '@prisma/client';
import {canonical} from './indicators.js';
import {revokeBrokerSession} from './broker-login.js';
export interface BrokerNetwork {clientLocalIp:string;clientPublicIp:string;macAddress:string;ipProof:{address:string;verifiedAt:string;expiresAt:string;sourceReference:string}}
export function validateBrokerNetwork(value:unknown):BrokerNetwork{
 const fail=()=>{throw new Error('INVALID_BROKER_NETWORK')};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const v=value as BrokerNetwork;
 if(Object.keys(v).sort().join('|')!=='clientLocalIp|clientPublicIp|ipProof|macAddress'||typeof v.clientLocalIp!=='string'||!isIP(v.clientLocalIp)||typeof v.clientPublicIp!=='string'||isIP(v.clientPublicIp)!==4||typeof v.macAddress!=='string'||!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v.macAddress))return fail();
 const p=v.ipProof;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join('|')!=='address|expiresAt|sourceReference|verifiedAt'||p.address!==v.clientPublicIp||typeof p.sourceReference!=='string'||!p.sourceReference.trim()||p.sourceReference.length>500||/[\r\n]/.test(p.sourceReference))return fail();
 const utc=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s)&&Number.isFinite(Date.parse(s));
 if(!utc(p.verifiedAt)||!utc(p.expiresAt)||Date.parse(p.verifiedAt)>Date.now()||Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.expiresAt)<=Date.parse(p.verifiedAt))return fail();
 return structuredClone(v);
}
export async function readBrokerNetwork(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string){
 const rows=await db.$queryRaw<{revision:string;network:BrokerNetwork}[]>`SELECT revision,evidence AS network FROM "BrokerNetworkConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
 return rows[0]??null;
}
/** Owner-entered verification evidence is not a licensing or market-readiness approval. */
export async function saveBrokerNetwork(db:PrismaClient,ownerId:string,value:unknown,expectedRevision:string){
 const network=validateBrokerNetwork(value);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const prior=await readBrokerNetwork(tx,ownerId);
  if((prior?.revision??'none')!==expectedRevision)throw new Error('BROKER_NETWORK_CONFLICT');
  if(prior&&canonical(prior.network)===canonical(network))return prior;
  await revokeBrokerSession(tx,ownerId);
  const revision=randomUUID(),evidence=canonical(network);
  await tx.$executeRaw`INSERT INTO "BrokerNetworkConfiguration" ("ownerId",revision,evidence) VALUES (${ownerId}::uuid,${revision}::uuid,${evidence}::jsonb) ON CONFLICT ("ownerId") DO UPDATE SET revision=EXCLUDED.revision,evidence=EXCLUDED.evidence,"updatedAt"=clock_timestamp()`;
  await tx.$executeRaw`INSERT INTO "BrokerNetworkEvent" (id,"ownerId","previousRevision",evidence) VALUES (${revision}::uuid,${ownerId}::uuid,${prior?.revision??null}::uuid,${evidence}::jsonb)`;
  return {revision,network};
 });
}
