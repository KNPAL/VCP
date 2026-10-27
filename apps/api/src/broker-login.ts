import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {Queue} from 'bullmq';
import {authenticateBroker,reserveBrokerBudget,type StaticIpProof} from '@vcp/market-data';
import {beginBrokerLogin,failBrokerLogin,completeBrokerLogin,resolveBrokerConfiguration,directoryBrokerKeys,type PrismaClient,type BrokerKeyResolver,type BrokerLoginError} from '@vcp/database';
export interface BrokerLoginDependencies {
 configurationKey:Buffer;sessionKeyId:string;loadSessionKey:BrokerKeyResolver;
 network:{clientLocalIp:string;clientPublicIp:string;macAddress:string;ipProof:StaticIpProof};
 reserve:(accountKey:string)=>Promise<{allowed:boolean}>;fetcher?:typeof fetch;close?:()=>Promise<void>;
}
export function validateLoginInput(value:unknown):{pin:string;totp:string}{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!=='pin|totp')throw new Error('INVALID_BROKER_LOGIN');
 const v=value as {pin:string;totp:string};if(typeof v.totp!=='string'||!/^\d{6}$/.test(v.totp))throw new Error('BAD_TOTP');if(typeof v.pin!=='string'||!/^\d{4,8}$/.test(v.pin))throw new Error('BAD_CREDENTIALS');return {pin:v.pin,totp:v.totp};
}
/** Dependencies are backend-only; network/static-IP proof never comes from browser input. */
export async function configuredLoginDependencies():Promise<BrokerLoginDependencies>{
 let key:Buffer|undefined;
 try{
  const path=process.env['VCP_BROKER_CONFIGURATION_KEY_FILE'],networkFile=process.env['VCP_BROKER_NETWORK_FILE'],directory=process.env['BROKER_KEY_DIRECTORY'],sessionKeyId=process.env['VCP_BROKER_SESSION_KEY_ID'];
  if(!path||!networkFile||!directory||!sessionKeyId||!/^[A-Za-z0-9_-]{1,64}$/.test(sessionKeyId))throw new Error();
  key=await readFile(path);if(key.length!==32)throw new Error();
  const raw=await readFile(networkFile,'utf8');if(raw.length>16384)throw new Error();const network=JSON.parse(raw) as BrokerLoginDependencies['network'];
  if(!network||typeof network!=='object'||Object.keys(network).sort().join('|')!=='clientLocalIp|clientPublicIp|ipProof|macAddress'||!isIP(network.clientLocalIp)||!isIP(network.clientPublicIp)||typeof network.macAddress!=='string'||!network.macAddress.trim()||network.macAddress.length>128||/[\r\n]/.test(network.macAddress))throw new Error();
  const loadSessionKey=directoryBrokerKeys(directory),preflight=await loadSessionKey(sessionKeyId);preflight.fill(0);
  const q=new Queue('vcp-broker-auth',{connection:{host:process.env['REDIS_HOST']??'127.0.0.1',port:Number(process.env['REDIS_PORT']??6379),maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:3000}});q.on('error',()=>{});
  return {configurationKey:key,sessionKeyId,loadSessionKey,network,reserve:async accountKey=>{for(let n=0;n<3;n++){const r=await reserveBrokerBudget(q,accountKey);if(r.allowed)return r;if(r.retryAfterMs>5000)break;await new Promise(resolve=>setTimeout(resolve,Math.max(1,r.retryAfterMs)))}return {allowed:false}},close:()=>q.close()};
 }catch{key?.fill(0);throw new Error('APP_CONFIG_INVALID')}
}
export async function loginOwnerBroker(db:PrismaClient,ownerId:string,value:unknown,loadDependencies:()=>Promise<BrokerLoginDependencies>=configuredLoginDependencies){
 const input=validateLoginInput(value);let deps:BrokerLoginDependencies|undefined,attempt:Awaited<ReturnType<typeof beginBrokerLogin>>|undefined,config:Awaited<ReturnType<typeof resolveBrokerConfiguration>>|undefined;
 try{
  deps=await loadDependencies();if(deps.configurationKey.length!==32)throw new Error('APP_CONFIG_INVALID');config=await resolveBrokerConfiguration(db,ownerId,deps.configurationKey);
  const proof=deps.network.ipProof,now=Date.now();if(!proof||proof.address!==deps.network.clientPublicIp||!proof.sourceReference||!Number.isFinite(Date.parse(proof.verifiedAt))||Date.parse(proof.verifiedAt)>now||!Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=now)throw new Error('STATIC_IP_NOT_VERIFIED');
  attempt=await beginBrokerLogin(db,ownerId);if(attempt.configurationRevision!==config.revision||attempt.accountKey!==config.accountKey)throw new Error('APP_CONFIG_INVALID');
  const authenticated=await authenticateBroker({clientCode:config.clientCode,apiKey:config.apiKey,pin:input.pin,totp:input.totp,clientLocalIp:deps.network.clientLocalIp,clientPublicIp:deps.network.clientPublicIp,macAddress:deps.network.macAddress},proof,{reserve:()=>deps!.reserve(config!.accountKey),...(deps.fetcher?{fetcher:deps.fetcher}:{})});
  const binding={reference:randomUUID(),accountKey:authenticated.accountKey,sessionRevision:randomUUID(),keyId:deps.sessionKeyId,expiresAt:authenticated.expiresAt};
  await completeBrokerLogin(db,ownerId,attempt.attemptId,binding,authenticated.secrets,{authenticated:true,staticIpVerified:true,verifiedAt:authenticated.verifiedAt},deps.loadSessionKey);
 }catch(error){
  const message=error instanceof Error?error.message:'',code:BrokerLoginError=message==='STATIC_IP_NOT_VERIFIED'?'STATIC_IP_NOT_VERIFIED':['APP_CONFIG_INVALID','BROKER_NOT_CONFIGURED','BROKER_CONFIGURATION_UNAVAILABLE'].includes(message)?'APP_CONFIG_INVALID':'PROVIDER_UNAVAILABLE';
  if(attempt)await failBrokerLogin(db,ownerId,attempt.attemptId,code).catch(()=>{});
  // eslint-disable-next-line preserve-caught-error -- Provider/storage causes must not escape the secret-handling boundary.
  if(['BROKER_LOGIN_IN_PROGRESS','BROKER_LOGIN_RATE_LIMITED'].includes(message))throw new Error(message);throw new Error(code);
 }finally{input.pin='';input.totp='';if(config){config.apiKey='';config.clientCode=''}deps?.configurationKey.fill(0);await deps?.close?.().catch(()=>{})}
}
