import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {brokerAccountKey} from '@vcp/market-data';
import {validateBrokerConfiguration,configurationFingerprint,encryptBrokerConfiguration,decryptBrokerConfiguration,type ConfigurationEnvelope} from './broker-configuration-vault.js';
export {validateBrokerConfiguration} from './broker-configuration-vault.js';
/** Configuration changes and session revocation commit together. No provider request occurs here. */
export async function saveBrokerConfiguration(db:PrismaClient,ownerId:string,value:unknown,idempotencyKey:string,key:Buffer){
 const input=validateBrokerConfiguration(value);
 if(typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>128)throw new Error('INVALID_BROKER_CONFIGURATION_KEY');
 const fingerprint=configurationFingerprint(ownerId,input,key),accountKey=brokerAccountKey(input.clientCode);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const receipts=await tx.$queryRaw<{fingerprint:string;revision:string}[]>`SELECT "fingerprint","revision" FROM "BrokerConfigurationReceipt" WHERE "ownerId"=${ownerId}::uuid AND "key"=${idempotencyKey}`;
  if(receipts[0]){if(receipts[0].fingerprint!==fingerprint)throw new Error('BROKER_CONFIGURATION_CONFLICT');return {revision:receipts[0].revision,reused:true}}
  const rows=await tx.$queryRaw<{revision:string;fingerprint:string;accountKey:string}[]>`SELECT "revision","fingerprint","accountKey" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
  const current=rows[0],same=current?.fingerprint===fingerprint,revision=same?current.revision:randomUUID();
  if(!same){
   const superseded=await tx.$queryRaw<{id:string}[]>`UPDATE "BrokerLoginAttempt" SET "state"='SUPERSEDED',"errorCode"='APP_CONFIG_INVALID',"finishedAt"=clock_timestamp() WHERE "ownerId"=${ownerId}::uuid AND "state"='AUTHENTICATING' RETURNING "id"`;
   for(const attempt of superseded)await tx.$executeRaw`INSERT INTO "BrokerLoginEvent" ("id","attemptId","state","errorCode") VALUES (${randomUUID()}::uuid,${attempt.id}::uuid,'SUPERSEDED','APP_CONFIG_INVALID')`;
   const envelope=encryptBrokerConfiguration(ownerId,revision,input,key),masked='••••';
   // Only revoke the previously owned configuration; a newly supplied account is not authenticated.
   if(current)await tx.$executeRaw`UPDATE "BrokerCircuit" SET "open"=true,"reason"='CONFIGURATION_CHANGED',"updatedAt"=clock_timestamp() WHERE "accountKey"=${current.accountKey}`;
   const paused=await tx.$queryRaw<{id:string}[]>`UPDATE "ManualDownloadRun" SET "state"='PAUSED_AUTH' WHERE "ownerId"=${ownerId}::uuid AND "state" IN ('QUEUED','RUNNING','PAUSED_QUOTA') RETURNING "id"`;
   for(const run of paused)await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${run.id}::uuid,'PAUSED_AUTH','{"reason":"BROKER_CONFIGURATION_CHANGED"}'::jsonb)`;
   await tx.$executeRaw`INSERT INTO "BrokerConfiguration" ("ownerId","revision","accountKey","fingerprint","apiKeyMasked","clientCodeMasked","envelope") VALUES (${ownerId}::uuid,${revision}::uuid,${accountKey},${fingerprint},${masked},${masked+input.clientCode.slice(-2)},${JSON.stringify(envelope)}::jsonb) ON CONFLICT ("ownerId") DO UPDATE SET "revision"=EXCLUDED."revision","accountKey"=EXCLUDED."accountKey","fingerprint"=EXCLUDED."fingerprint","apiKeyMasked"=EXCLUDED."apiKeyMasked","clientCodeMasked"=EXCLUDED."clientCodeMasked","envelope"=EXCLUDED."envelope","updatedAt"=clock_timestamp()`;
   await tx.$executeRaw`INSERT INTO "BrokerConfigurationEvent" ("id","ownerId","revision","previousRevision","kind") VALUES (${randomUUID()}::uuid,${ownerId}::uuid,${revision}::uuid,${current?.revision??null}::uuid,'CONFIGURATION_SAVED')`;
  }
  await tx.$executeRaw`INSERT INTO "BrokerConfigurationReceipt" ("ownerId","key","fingerprint","revision") VALUES (${ownerId}::uuid,${idempotencyKey},${fingerprint},${revision}::uuid)`;
  return {revision,reused:!!same};
 });
}
export async function readBrokerConfiguration(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string){
 const rows=await db.$queryRaw<{revision:string;apiKeyMasked:string;clientCodeMasked:string;updatedAt:Date}[]>`SELECT "revision","apiKeyMasked","clientCodeMasked","updatedAt" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
 return rows[0]?{configured:true,revision:rows[0].revision,apiKeyMasked:rows[0].apiKeyMasked,clientCodeMasked:rows[0].clientCodeMasked,updatedAt:rows[0].updatedAt.toISOString()}:{configured:false,revision:null,apiKeyMasked:null,clientCodeMasked:null,updatedAt:null};
}
/** Internal login dependency: obtain secrets only immediately before provider authentication. */
export async function resolveBrokerConfiguration(db:PrismaClient,ownerId:string,key:Buffer){
 const rows=await db.$queryRaw<{revision:string;accountKey:string;envelope:ConfigurationEnvelope}[]>`SELECT "revision","accountKey","envelope" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
 const row=rows[0];if(!row)throw new Error('BROKER_NOT_CONFIGURED');
 const input=decryptBrokerConfiguration(ownerId,row.revision,row.envelope,key);if(brokerAccountKey(input.clientCode)!==row.accountKey)throw new Error('BROKER_CONFIGURATION_UNAVAILABLE');return {revision:row.revision,accountKey:row.accountKey,...input};
}
/** Internal routing metadata only; never expose account hashes in public responses. */
export async function ownerBrokerBinding(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string,legacyAccountKey?:string){
 const rows=await db.$queryRaw<{accountKey:string;revision:string;updatedAt:Date}[]>`SELECT "accountKey","revision","updatedAt" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
 return {accountKey:rows[0]?.accountKey??legacyAccountKey,configurationRevision:rows[0]?.revision??null,configuredAt:rows[0]?.updatedAt.toISOString()??null};
}
