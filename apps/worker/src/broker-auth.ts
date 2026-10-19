import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {authenticateBroker,brokerAccountKey,type BrokerLogin,type StaticIpProof} from '@vcp/market-data';
import {installBrokerSession,brokerCircuitStore,type PrismaClient,type BrokerKeyResolver} from '@vcp/database';
import type {Queue} from 'bullmq';
import {reserveBrokerBudget} from './broker-budget.js';
import {trace} from '@vcp/domain/logging';
/** Keys are deployment secrets in a configured directory, never database fields or queue data. */
export function directoryBrokerKeys(directory:string):BrokerKeyResolver {
 if(!directory.trim())throw new Error('BROKER_UNAVAILABLE');
 const root=resolve(directory);
 return async keyId=>{try{if(!/^[A-Za-z0-9_-]{1,64}$/.test(keyId))throw new Error();const encoded=(await readFile(join(root,keyId+'.key'),'utf8')).trim(),key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw new Error();return key}catch{throw new Error('BROKER_UNAVAILABLE')}};
}
export async function provisionBrokerSession(db:PrismaClient,q:Queue,input:{login:BrokerLogin;ipProof:StaticIpProof;keyId:string;loadKey:BrokerKeyResolver},deps:{fetcher?:typeof fetch;now?:()=>string}={}){
 return trace('broker.auth',()=>provisionSession(db,q,input,deps));
}
async function provisionSession(db:PrismaClient,q:Queue,input:{login:BrokerLogin;ipProof:StaticIpProof;keyId:string;loadKey:BrokerKeyResolver},deps:{fetcher?:typeof fetch;now?:()=>string}={}){
 const store=brokerCircuitStore(db,brokerAccountKey(input.login.clientCode)),now=deps.now??(()=>new Date().toISOString());let prior:Awaited<ReturnType<typeof store.readCircuit>>=null;
 try{
  prior=await store.readCircuit();
  const preflight=Buffer.from(await input.loadKey(input.keyId));try{if(preflight.length!==32)throw new Error()}finally{preflight.fill(0)}
  const authenticated=await authenticateBroker(input.login,input.ipProof,{...deps,reserve:async()=>{
   for(let attempt=0;attempt<4;attempt++){const reservation=await reserveBrokerBudget(q,brokerAccountKey(input.login.clientCode));if(reservation.allowed)return reservation;if(reservation.retryAfterMs>10000)break;await new Promise(resolve=>setTimeout(resolve,Math.max(1,reservation.retryAfterMs)))}return {allowed:false};
  }});
  return await installBrokerSession(db,{reference:randomUUID(),accountKey:authenticated.accountKey,sessionRevision:randomUUID(),keyId:input.keyId,expiresAt:authenticated.expiresAt},authenticated.secrets,{authenticated:true,staticIpVerified:true,verifiedAt:authenticated.verifiedAt},input.loadKey,now());
 }catch{if(prior)try{await store.openCircuit(prior.sessionRevision,'AUTH_REJECTED')}catch{/* Never expose storage/provider details. */}throw new Error('BROKER_UNAVAILABLE')}
}
