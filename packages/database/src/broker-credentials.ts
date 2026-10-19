import type {PrismaClient} from '@prisma/client';
import {encryptBrokerCredentials,decryptBrokerCredentials,type CredentialBinding,type EncryptedCredential,type BrokerSecrets} from '@vcp/market-data';
import {restoreBrokerCircuit} from './broker-circuit.js';
export type BrokerKeyResolver=(keyId:string)=>Promise<Buffer>;
/** Internal authentication boundary: caller supplies independently verified auth/static-IP proof. */
export async function installBrokerSession(db:PrismaClient,binding:CredentialBinding,secrets:BrokerSecrets,proof:{authenticated:boolean;staticIpVerified:boolean;verifiedAt:string},loadKey:BrokerKeyResolver,now=new Date().toISOString()){
 try{
  const key=Buffer.from(await loadKey(binding.keyId));let envelope:EncryptedCredential;
  try{envelope=encryptBrokerCredentials(binding,secrets,key)}finally{key.fill(0)}
  await restoreBrokerCircuit(db,binding.accountKey,{...proof,sessionRevision:binding.sessionRevision,expiresAt:binding.expiresAt},now,async tx=>{
   await tx.$executeRaw`INSERT INTO "BrokerCredential" ("reference","accountKey","sessionRevision","keyId","expiresAt","envelope") VALUES (${binding.reference}::uuid,${binding.accountKey},${binding.sessionRevision}::uuid,${binding.keyId},${new Date(binding.expiresAt)},${JSON.stringify({binding,envelope})}::jsonb)`;
  });
  return {reference:binding.reference,accountKey:binding.accountKey,sessionRevision:binding.sessionRevision,expiresAt:binding.expiresAt};
 }catch{throw new Error('BROKER_UNAVAILABLE')}
}
/** Worker-only resolution. Circuit checks are repeated by the request gateway before sending. */
export async function resolveBrokerSession(db:PrismaClient,reference:string,loadKey:BrokerKeyResolver,now=new Date().toISOString()){
 try{
  const rows=await db.$queryRaw<{accountKey:string;sessionRevision:string;keyId:string;expiresAt:Date;envelope:{binding:CredentialBinding;envelope:EncryptedCredential}}[]>`SELECT s."accountKey",s."sessionRevision",s."keyId",s."expiresAt",s."envelope" FROM "BrokerCredential" s JOIN "BrokerCircuit" c ON c."accountKey"=s."accountKey" AND c."sessionRevision"=s."sessionRevision" WHERE s."reference"=${reference}::uuid AND NOT c."open" AND c."verifiedAt"<=${new Date(now)} AND c."expiresAt">${new Date(now)} AND s."expiresAt"=c."expiresAt"`;
  const row=rows[0],stored=row?.envelope;if(!stored||stored.binding.reference!==reference||stored.binding.accountKey!==row!.accountKey||stored.binding.sessionRevision!==row!.sessionRevision||stored.binding.keyId!==row!.keyId||new Date(stored.binding.expiresAt).valueOf()!==row!.expiresAt.valueOf())throw new Error();
  const key=Buffer.from(await loadKey(stored.binding.keyId));
  try{return {accountKey:stored.binding.accountKey,sessionRevision:stored.binding.sessionRevision,staticIpVerified:true as const,secrets:decryptBrokerCredentials(stored.binding,stored.envelope,key,now)}}finally{key.fill(0)}
 }catch{throw new Error('BROKER_UNAVAILABLE')}
}
