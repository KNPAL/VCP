import {readFile} from 'node:fs/promises';
import {utcInstant} from '@vcp/domain';
import {isIP} from 'node:net';
import {readBrokerConnection,resolveBrokerConfiguration,resolveBrokerSession,directoryBrokerKeys,getReadiness,type PrismaClient,type BrokerKeyResolver} from '@vcp/database';
export interface BrokerStatusDependencies {
 configurationKey:()=>Promise<Buffer>;
 network:()=>Promise<unknown>;
 loadSessionKey:BrokerKeyResolver;
 liveEnabled:boolean;
}
export function configuredStatusDependencies():BrokerStatusDependencies{return {
 configurationKey:async()=>{const file=process.env['VCP_BROKER_CONFIGURATION_KEY_FILE'];if(!file)throw new Error('APP_CONFIG_INVALID');return readFile(file)},
 network:async()=>{const file=process.env['VCP_BROKER_NETWORK_FILE'];if(!file)return null;const raw=await readFile(file,'utf8');if(raw.length>16384)throw new Error('INVALID_NETWORK_PROOF');return JSON.parse(raw) as unknown},
 loadSessionKey:async id=>{const directory=process.env['BROKER_KEY_DIRECTORY'];if(!directory)throw new Error('BROKER_UNAVAILABLE');return directoryBrokerKeys(directory)(id)},
 liveEnabled:process.env['VCP_ENABLE_LIVE_STREAM']==='true',
}}
export function networkStatus(value:unknown,now=Date.now()){
 const unknown={staticIpStatus:'UNKNOWN',serverPublicIpDisplayOrNull:null as string|null,staticIpVerifiedAt:null as string|null,staticIpValidUntil:null as string|null};
 if(!value||typeof value!=='object')return unknown;
 const v=value as Record<string,unknown>,p=v['ipProof'];if(!p||typeof p!=='object')return unknown;const proof=p as Record<string,unknown>;
 if(typeof v['clientPublicIp']!=='string'||!isIP(v['clientPublicIp'])||proof['address']!==v['clientPublicIp']||typeof proof['sourceReference']!=='string'||!proof['sourceReference'].trim()||typeof proof['verifiedAt']!=='string'||typeof proof['expiresAt']!=='string')return unknown;
 let verified:number,expires:number;try{verified=utcInstant(proof['verifiedAt']).valueOf();expires=utcInstant(proof['expiresAt']).valueOf()}catch{return unknown}if(verified>now||expires<=verified)return unknown;
 return expires<=now?{...unknown,staticIpStatus:'EXPIRED'}:{staticIpStatus:'VERIFIED',serverPublicIpDisplayOrNull:v['clientPublicIp'],staticIpVerifiedAt:proof['verifiedAt'],staticIpValidUntil:proof['expiresAt']};
}
/** Reads local configuration/session evidence only. Never contacts the broker or returns secrets. */
export async function readRuntimeBrokerStatus(db:PrismaClient,ownerId:string,legacyAccount?:string,deps=configuredStatusDependencies()){
 const base=await readBrokerConnection(db,ownerId,legacyAccount),networkValue=await deps.network().catch(()=>null);let network=networkStatus(networkValue);
 let configurationError=false,credentialError=false,matchingSession=false,feed=false;
 let key:Buffer|undefined,config:Awaited<ReturnType<typeof resolveBrokerConfiguration>>|undefined,session:Awaited<ReturnType<typeof resolveBrokerSession>>|undefined;
 try{
  if(base.configured){
   try{key=await deps.configurationKey();if(key.length!==32)throw new Error();config=await resolveBrokerConfiguration(db,ownerId,key);if(config.revision!==base.revision)throw new Error()}catch{configurationError=true}
   if(config&&base.authenticated&&!configurationError){
    try{
     const refs=await db.$queryRaw<{reference:string}[]>`SELECT s."reference" FROM "BrokerCredential" s JOIN "BrokerCircuit" c ON c."accountKey"=s."accountKey" AND c."sessionRevision"=s."sessionRevision" WHERE s."accountKey"=${config.accountKey} AND NOT c."open" AND s."expiresAt"=c."expiresAt" ORDER BY s."reference" LIMIT 1`;
     if(!refs[0])throw new Error();session=await resolveBrokerSession(db,refs[0].reference,deps.loadSessionKey);
     matchingSession=session.secrets.apiKey===config.apiKey&&session.secrets.clientPublicIp===network.serverPublicIpDisplayOrNull;
     feed=!!session.secrets.feedToken&&session.secrets.clientCode===config.clientCode;
    }catch{credentialError=true}
   }
  }
 }finally{key?.fill(0);if(config){config.apiKey='';config.clientCode=''}if(session){for(const key of Object.keys(session.secrets) as (keyof typeof session.secrets)[])session.secrets[key]=''}}
 const latest=await readBrokerConnection(db,ownerId,legacyAccount);
 const unchanged=base.revision===latest.revision&&base.sessionState===latest.sessionState&&base.lastVerifiedAt===latest.lastVerifiedAt&&base.tokenExpiresAt===latest.tokenExpiresAt;
 const gates=await getReadiness(db),liveGates=gates.items.filter(g=>['G01','G07','G09'].includes(g.gate)).every(g=>g.status==='PASS');
 network=networkStatus(networkValue);
 const configError=unchanged&&latest.configured&&configurationError,unavailable=unchanged&&latest.authenticated&&credentialError;
 const authenticated=latest.authenticated&&!configError&&!unavailable;
 const usable=unchanged&&authenticated&&matchingSession&&network.staticIpStatus==='VERIFIED';
 const history=usable&&latest.historyReady,live=usable&&feed&&deps.liveEnabled&&liveGates;
 const expiry=(values:(string|null|undefined)[])=>{const dates=values.filter((v):v is string=>!!v).map(v=>Date.parse(v));return dates.length?new Date(Math.min(...dates)).toISOString():null};
 const liveValidUntil=live?expiry([latest.tokenExpiresAt,network.staticIpValidUntil,...gates.items.filter(g=>['G01','G07','G09'].includes(g.gate)).map(g=>g.proof?.expiresAt)]):null;
 const sessionState=configError?'CONFIG_ERROR':unavailable?'UNAVAILABLE':latest.sessionState;
 return {...latest,...network,liveValidUntil,validUntil:expiry([latest.validUntil,network.staticIpValidUntil]),sessionState,state:latest.configured?sessionState:latest.state,authenticated,historyReady:history,canFetchHistory:history,canStreamLive:live,permissions:{orders:false,history,live},lastErrorCode:configError?'APP_CONFIG_INVALID':unavailable?'PROVIDER_UNAVAILABLE':latest.lastErrorCode??(unchanged&&latest.authenticated&&(!matchingSession||network.staticIpStatus!=='VERIFIED')?'STATIC_IP_NOT_VERIFIED':null)};
}
