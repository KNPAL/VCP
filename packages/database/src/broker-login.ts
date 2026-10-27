import {randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import type {BrokerSecrets,CredentialBinding} from '@vcp/market-data';
import {installBrokerSession,type BrokerKeyResolver} from './broker-credentials.js';
export const brokerLoginErrors=['BAD_CREDENTIALS','BAD_TOTP','APP_CONFIG_INVALID','STATIC_IP_NOT_VERIFIED','PROVIDER_UNAVAILABLE','SESSION_EXPIRED'] as const;
export type BrokerLoginError=typeof brokerLoginErrors[number];
async function event(tx:Prisma.TransactionClient,attemptId:string,state:string,errorCode:string|null){await tx.$executeRaw`INSERT INTO "BrokerLoginEvent" ("id","attemptId","state","errorCode") VALUES (${randomUUID()}::uuid,${attemptId}::uuid,${state},${errorCode})`}
/** No PIN, TOTP or provider payload enters this durable boundary. */
export async function beginBrokerLogin(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const configs=await tx.$queryRaw<{revision:string;accountKey:string}[]>`SELECT "revision","accountKey" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
  const config=configs[0];if(!config)throw new Error('BROKER_NOT_CONFIGURED');
  const active=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "BrokerLoginAttempt" WHERE "ownerId"=${ownerId}::uuid AND "configurationRevision"=${config.revision}::uuid AND "state"='AUTHENTICATING' AND "expiresAt">clock_timestamp()`;
  if(active.length)throw new Error('BROKER_LOGIN_IN_PROGRESS');
  const recent=await tx.$queryRaw<{count:number}[]>`SELECT count(*)::integer AS count FROM "BrokerLoginAttempt" WHERE "ownerId"=${ownerId}::uuid AND "startedAt">clock_timestamp()-interval '15 minutes'`;
  if(recent[0]!.count>=5)throw new Error('BROKER_LOGIN_RATE_LIMITED');
  const old=await tx.$queryRaw<{id:string}[]>`UPDATE "BrokerLoginAttempt" SET "state"='SUPERSEDED',"errorCode"='SESSION_EXPIRED',"finishedAt"=clock_timestamp() WHERE "ownerId"=${ownerId}::uuid AND "state"='AUTHENTICATING' RETURNING "id"`;
  for(const row of old)await event(tx,row.id,'SUPERSEDED','SESSION_EXPIRED');
  const id=randomUUID();
  const rows=await tx.$queryRaw<{expiresAt:Date}[]>`INSERT INTO "BrokerLoginAttempt" ("id","ownerId","configurationRevision","accountKey","state","expiresAt") VALUES (${id}::uuid,${ownerId}::uuid,${config.revision}::uuid,${config.accountKey},'AUTHENTICATING',clock_timestamp()+interval '60 seconds') RETURNING "expiresAt"`;
  await tx.$executeRaw`UPDATE "BrokerCircuit" SET "open"=true,"reason"='AUTHENTICATING',"updatedAt"=clock_timestamp() WHERE "accountKey"=${config.accountKey}`;
  await event(tx,id,'AUTHENTICATING',null);
  return {attemptId:id,configurationRevision:config.revision,accountKey:config.accountKey,expiresAt:rows[0]!.expiresAt.toISOString()};
 });
}
export async function failBrokerLogin(db:PrismaClient,ownerId:string,attemptId:string,errorCode:BrokerLoginError){
 if(!brokerLoginErrors.includes(errorCode))throw new Error('INVALID_BROKER_LOGIN_ERROR');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const changed=await tx.$executeRaw`UPDATE "BrokerLoginAttempt" SET "state"='FAILED',"errorCode"=${errorCode},"finishedAt"=clock_timestamp() WHERE "id"=${attemptId}::uuid AND "ownerId"=${ownerId}::uuid AND "state"='AUTHENTICATING'`;
  if(changed)await event(tx,attemptId,'FAILED',errorCode);return {changed:changed===1};
 });
}
/** Local revocation is independent of provider availability and fences in-flight login responses. */
export async function logoutBroker(db:PrismaClient,ownerId:string){
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const configs=await tx.$queryRaw<{accountKey:string}[]>`SELECT "accountKey" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
  const attempts=await tx.$queryRaw<{id:string}[]>`UPDATE "BrokerLoginAttempt" SET "state"='SUPERSEDED',"errorCode"='SESSION_EXPIRED',"finishedAt"=clock_timestamp() WHERE "ownerId"=${ownerId}::uuid AND "state" IN ('AUTHENTICATING','CONNECTED') RETURNING "id"`;
  for(const attempt of attempts)await event(tx,attempt.id,'SUPERSEDED','SESSION_EXPIRED');
  if(configs[0])await tx.$executeRaw`UPDATE "BrokerCircuit" SET "open"=true,"reason"='LOGGED_OUT',"updatedAt"=clock_timestamp() WHERE "accountKey"=${configs[0].accountKey}`;
  const paused=await tx.$queryRaw<{id:string}[]>`UPDATE "ManualDownloadRun" SET "state"='PAUSED_AUTH' WHERE "ownerId"=${ownerId}::uuid AND "state" IN ('QUEUED','RUNNING','PAUSED_QUOTA') RETURNING "id"`;
  for(const run of paused)await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${run.id}::uuid,'PAUSED_AUTH','{"reason":"BROKER_LOGGED_OUT"}'::jsonb)`;
  return {revoked:true};
 });
}
/** Provider-verified credentials are installed only if this attempt still owns the current configuration. */
export async function completeBrokerLogin(db:PrismaClient,ownerId:string,attemptId:string,binding:CredentialBinding,secrets:BrokerSecrets,proof:{authenticated:boolean;staticIpVerified:boolean;verifiedAt:string},loadKey:BrokerKeyResolver){
 return installBrokerSession(db,binding,secrets,proof,loadKey,new Date().toISOString(),async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},140))`;
  const attempts=await tx.$queryRaw<{id:string}[]>`SELECT a."id" FROM "BrokerLoginAttempt" a JOIN "BrokerConfiguration" c ON c."ownerId"=a."ownerId" AND c."revision"=a."configurationRevision" AND c."accountKey"=a."accountKey" WHERE a."id"=${attemptId}::uuid AND a."ownerId"=${ownerId}::uuid AND a."accountKey"=${binding.accountKey} AND a."state"='AUTHENTICATING' AND a."expiresAt">clock_timestamp() AND a."startedAt"<=${new Date(proof.verifiedAt)} FOR UPDATE OF a`;
  if(!attempts.length)throw new Error('BROKER_LOGIN_SUPERSEDED');
  await tx.$executeRaw`UPDATE "BrokerLoginAttempt" SET "state"='CONNECTED',"sessionRevision"=${binding.sessionRevision}::uuid,"finishedAt"=clock_timestamp() WHERE "id"=${attemptId}::uuid`;
  await event(tx,attemptId,'CONNECTED',null);
 });
}
