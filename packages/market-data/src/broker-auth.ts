import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {utcInstant,exchangeDate} from '@vcp/domain';
import type {BrokerSecrets} from './historical-transport.js';
export interface BrokerLogin {clientCode:string;pin:string;totp:string;apiKey:string;clientLocalIp:string;clientPublicIp:string;macAddress:string}
export interface StaticIpProof {address:string;verifiedAt:string;expiresAt:string;sourceReference:string}
export const brokerAccountKey=(clientCode:string)=>createHash('sha256').update('ANGEL_ONE|'+clientCode).digest('hex');
/** Only login and read-only profile verification; PIN/TOTP/refresh tokens are never retained. */
export async function authenticateBroker(input:BrokerLogin,proof:StaticIpProof,deps:{reserve:()=>Promise<{allowed:boolean}>;fetcher?:typeof fetch;now?:()=>string;timeoutMs?:number}){
 const now=deps.now??(()=>new Date().toISOString()),fetcher=deps.fetcher??fetch,timeout=deps.timeoutMs??20000;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new Error();
  const at=utcInstant(now()).valueOf();
  if(!/^[A-Za-z0-9]{3,32}$/.test(input.clientCode)||!/^\d{4,8}$/.test(input.pin)||!/^\d{6}$/.test(input.totp)||!isIP(input.clientLocalIp)||!isIP(input.clientPublicIp)||Object.values(input).some(v=>typeof v!=='string'||!v.trim()||v.length>16000||/[\r\n]/.test(v)))throw new Error();
  if(proof.address!==input.clientPublicIp||!proof.sourceReference||utcInstant(proof.verifiedAt).valueOf()>at||utcInstant(proof.expiresAt).valueOf()<=at)throw new Error();
  const work=async()=>{
   const base={'Content-Type':'application/json','Accept':'application/json','X-UserType':'USER','X-SourceID':'WEB','X-ClientLocalIP':input.clientLocalIp,'X-ClientPublicIP':input.clientPublicIp,'X-MACAddress':input.macAddress,'X-PrivateKey':input.apiKey};
   async function request(path:string,method:string,body?:string,token?:string){
    if(!(await deps.reserve()).allowed||controller.signal.aborted)throw new Error();
    const response=await fetcher('https://apiconnect.angelone.in'+path,{method,redirect:'error',signal:controller.signal,headers:{...base,...(token?{Authorization:'Bearer '+token}:{})},...(body?{body}:{})});
    if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new Error()}
    const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144){await reader.cancel();throw new Error()}chunks.push(part.value)}}finally{reader.releaseLock()}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {status?:unknown;data?:Record<string,unknown>;errorcode?:unknown};
    if(!result||result.status!==true||!result.data||typeof result.data!=='object'||Array.isArray(result.data)||(result.errorcode!==undefined&&result.errorcode!==''&&result.errorcode!==null))throw new Error();return result.data;
   }
   const login=await request('/rest/auth/angelbroking/user/v1/loginByPassword','POST',JSON.stringify({clientcode:input.clientCode,password:input.pin,totp:input.totp}));
   const token=login['jwtToken'];if(typeof token!=='string'||token.length>16000||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error();
   // Claims only restrict expiry. The provider profile verifies the token and account.
   const claims=JSON.parse(Buffer.from(token.split('.')[1]!,'base64url').toString('utf8')) as {exp?:unknown};
   if(!Number.isSafeInteger(claims.exp)||Number(claims.exp)<=0)throw new Error();
   const profile=await request('/rest/secure/angelbroking/user/v1/getProfile','GET',undefined,token);
   if(profile['clientcode']!==input.clientCode)throw new Error();
   const verifiedAt=now(),date=exchangeDate(verifiedAt),midnight=new Date(date+'T18:30:00Z').valueOf();
   const expiry=Math.min(Number(claims.exp)*1000,midnight,utcInstant(proof.expiresAt).valueOf());
   if(utcInstant(verifiedAt).valueOf()<at||expiry<=utcInstant(verifiedAt).valueOf()||controller.signal.aborted)throw new Error();
   const secrets:BrokerSecrets={accessToken:token,apiKey:input.apiKey,clientLocalIp:input.clientLocalIp,clientPublicIp:input.clientPublicIp,macAddress:input.macAddress};
   if(typeof login['feedToken']==='string'&&login['feedToken'].trim()&&login['feedToken'].length<=16000&&!/[\r\n]/.test(login['feedToken'])){secrets.clientCode=input.clientCode;secrets.feedToken=login['feedToken']}
   return {accountKey:brokerAccountKey(input.clientCode),verifiedAt,expiresAt:new Date(expiry).toISOString(),secrets};
  };
  return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error())},timeout)})]);
 }catch{throw new Error('BROKER_UNAVAILABLE')}finally{if(timer)clearTimeout(timer)}
}
