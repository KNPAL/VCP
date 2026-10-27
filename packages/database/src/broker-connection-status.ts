import type {PrismaClient} from '@prisma/client';
import {readBrokerConfiguration} from './broker-configuration.js';
import {readBrokerHealth} from './data-health.js';
/** Public status excludes account hashes, credential references and encrypted payloads. */
export async function readBrokerConnection(db:PrismaClient,ownerId:string,legacyAccountKey?:string){
 return db.$transaction(tx=>readConnectionSnapshot(tx,ownerId,legacyAccountKey),{isolationLevel:'RepeatableRead'});
}
async function readConnectionSnapshot(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string,legacyAccountKey?:string){
 const configuration=await readBrokerConfiguration(db,ownerId);
 const rows=await db.$queryRaw<{accountKey:string;updatedAt:Date}[]>`SELECT "accountKey","updatedAt" FROM "BrokerConfiguration" WHERE "ownerId"=${ownerId}::uuid`;
 const row=rows[0],health=await readBrokerHealth(db,row?.accountKey??legacyAccountKey);
 const currentSession=!!row&&!!health.sourceAt&&Date.parse(health.sourceAt)>row.updatedAt.valueOf(),fresh=currentSession&&health.authenticated;
 const sessions=currentSession?await db.$queryRaw<{expiresAt:Date;reason:string|null}[]>`SELECT "expiresAt","reason" FROM "BrokerCircuit" WHERE "accountKey"=${row!.accountKey}`:[];
 const attempts=configuration.revision?await db.$queryRaw<{state:string;errorCode:string|null;expiresAt:Date}[]>`SELECT "state","errorCode","expiresAt" FROM "BrokerLoginAttempt" WHERE "ownerId"=${ownerId}::uuid AND "configurationRevision"=${configuration.revision}::uuid ORDER BY "startedAt" DESC,"id" LIMIT 1`:[];
 const attempt=attempts[0],authenticating=attempt?.state==='AUTHENTICATING'&&attempt.expiresAt.valueOf()>Date.now(),timedOut=attempt?.state==='AUTHENTICATING'&&!authenticating;
 const loggedOut=sessions[0]?.reason==='LOGGED_OUT';
 const sessionState=!configuration.configured?'NOT_CONFIGURED':authenticating?'AUTHENTICATING':loggedOut?'NEEDS_LOGIN':timedOut?'NEEDS_LOGIN':!currentSession?'NEEDS_LOGIN':fresh?'CONNECTED':health.state==='EXPIRED'?'EXPIRED':health.reasons.includes('BROKER_CIRCUIT_OPEN')?'UNAVAILABLE':'NEEDS_LOGIN';
 return {...health,...configuration,provider:'ANGEL_ONE',sessionState,state:row?sessionState:health.state,authenticated:row?fresh:health.authenticated,historyReady:row?fresh&&health.historyReady:health.historyReady,staticIpStatus:fresh?'VERIFIED':'UNKNOWN',serverPublicIpDisplayOrNull:null,sessionAuthenticatedAt:fresh?health.sourceAt:null,tokenExpiresAt:sessions[0]?.expiresAt.toISOString()??null,lastVerifiedAt:currentSession?health.sourceAt:null,lastErrorCode:loggedOut?null:timedOut?'SESSION_EXPIRED':attempt?.state==='FAILED'?attempt.errorCode:sessionState==='UNAVAILABLE'?'PROVIDER_UNAVAILABLE':sessionState==='EXPIRED'?'SESSION_EXPIRED':null,canFetchHistory:row?fresh&&health.historyReady:health.historyReady,canStreamLive:false,permissions:{orders:false,history:row?fresh&&health.historyReady:health.historyReady,live:false}};
}
