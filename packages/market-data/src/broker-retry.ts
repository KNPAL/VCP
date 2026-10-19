import {randomUUID} from 'node:crypto';
import {utcInstant} from '@vcp/domain';
import {trace,logContext} from '@vcp/domain/logging';
export type BrokerFailure='AUTH_REJECTED'|'AUTH_CIRCUIT_OPEN'|'BROKER_SESSION_CHANGED'|'RATE_LIMITED'|'BROKER_TRANSIENT'|'BROKER_REJECTED'|'INVALID_BROKER_RESPONSE'|'TRANSPORT_UNAVAILABLE'|'REQUEST_TIMEOUT'|'GLOBAL_BUDGET_UNAVAILABLE'|'BROKER_PREREQUISITE_UNKNOWN';
export interface BrokerCircuit {sessionRevision:string;open:boolean;expiresAt:string}
export interface BrokerAttempt {requestId:string;attempt:number;at:string;reason:BrokerFailure|null;httpStatus:number|null;retryInMs:number|null}
export interface BrokerRetryDependencies {
 readCircuit:()=>Promise<BrokerCircuit|null>;
 openCircuit:(sessionRevision:string,reason:BrokerFailure)=>Promise<void>;
 audit:(attempt:BrokerAttempt)=>Promise<void>;
 acquireBudget:()=>Promise<{allowed:boolean;retryAfterMs:number}>;
 send:(signal:AbortSignal)=>Promise<{status:number;contentType:string;body:string;retryAfterMs?:number}>;
 now?:()=>string;sleep?:(ms:number)=>Promise<void>;random?:()=>number;
}
const authCodes=new Set(['AG8001','AG8002','AG8003','AB8050','AB8051','AB1000','AB1001','AB1002','AB1010','AB1011']);
async function deadline<T>(work:()=>Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('DEPENDENCY_TIMEOUT')),ms)})])}finally{if(timer)clearTimeout(timer)}}
export function classifyBrokerResponse(response:{status:number;contentType:string;body:string}){
 const fail=(reason:BrokerFailure,retryable=false,trip=false)=>({ok:false as const,reason,retryable,trip});
 if(response.status===401||response.status===403)return fail('AUTH_REJECTED',false,true);
 if(response.status===429)return fail('RATE_LIMITED',true);
 if(response.status>=500&&response.status<=599)return fail('BROKER_TRANSIENT',true);
 if(response.status<200||response.status>=300)return fail('BROKER_REJECTED');
 if(!/^application\/json(?:\s*;|$)/i.test(response.contentType)||response.body.length>8_000_000)return fail('INVALID_BROKER_RESPONSE',false,true);
 let body:unknown;try{body=JSON.parse(response.body,(_key,value:unknown,context?:{source?:string})=>{if(typeof value!=='number')return value;if(!context?.source)throw new Error('LOSSLESS_JSON_UNAVAILABLE');return context.source})}catch{return fail('INVALID_BROKER_RESPONSE',false,true)}
 if(!body||typeof body!=='object'||Array.isArray(body))return fail('INVALID_BROKER_RESPONSE',false,true);
 const value=body as Record<string,unknown>,code=value['errorcode'];
 if(typeof code==='string'&&authCodes.has(code))return fail('AUTH_REJECTED',false,true);
 if(value['status']!==true){if(code==='AB1004'||code==='AB9000')return fail('BROKER_TRANSIENT',true);if(value['data']===null)return fail('INVALID_BROKER_RESPONSE',false,true);return fail('BROKER_REJECTED')}
 if(!Array.isArray(value['data']))return fail('INVALID_BROKER_RESPONSE',false,true);
 // [] is a genuine empty response, not proof of complete historical coverage.
 return {ok:true as const,data:value['data'] as unknown[]};
}
/** Read-only historical requests only; validation/ingestion occurs once, after success. */
export function historicalRequest(input:{sessionRevision:string;staticIpVerified:boolean;downloadAllowed:boolean;maxAttempts?:number;timeoutMs?:number},deps:BrokerRetryDependencies){return trace('broker.history',()=>historicalRequestImpl(input,deps))}
async function historicalRequestImpl(input:{sessionRevision:string;staticIpVerified:boolean;downloadAllowed:boolean;maxAttempts?:number;timeoutMs?:number},deps:BrokerRetryDependencies){
 const maxAttempts=input.maxAttempts??4,timeoutMs=input.timeoutMs??10000;
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>4||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('INVALID_RETRY_POLICY');
 const requestId=logContext()?.spanId??randomUUID(),now=deps.now??(()=>new Date().toISOString()),sleep=deps.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),random=deps.random??Math.random;
 const failure=(reason:BrokerFailure,attempts:number,retryAfterMs:number|null=null)=>({state:'UNKNOWN' as const,code:'BROKER_UNAVAILABLE',reason,requestId,attempts,retryAfterMs,data:null});
 if(!input.staticIpVerified||!input.downloadAllowed)return failure('BROKER_PREREQUISITE_UNKNOWN',0);
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  let circuit;try{circuit=await deadline(deps.readCircuit,timeoutMs)}catch{return failure('BROKER_PREREQUISITE_UNKNOWN',attempt-1)}
  if(!circuit||circuit.open||utcInstant(circuit.expiresAt)<=utcInstant(now()))return failure('AUTH_CIRCUIT_OPEN',attempt-1);
  if(circuit.sessionRevision!==input.sessionRevision)return failure('BROKER_SESSION_CHANGED',attempt-1);
  let budget;try{budget=await deadline(deps.acquireBudget,timeoutMs)}catch{return failure('GLOBAL_BUDGET_UNAVAILABLE',attempt-1)}
  if(!budget.allowed){const retryAfterMs=Number.isFinite(budget.retryAfterMs)&&budget.retryAfterMs>=0?Math.min(2147483647,Math.ceil(budget.retryAfterMs)):null;await deps.audit({requestId,attempt,at:now(),reason:'RATE_LIMITED',httpStatus:null,retryInMs:retryAfterMs});return failure('RATE_LIMITED',attempt-1,retryAfterMs)}
  let response:Awaited<ReturnType<BrokerRetryDependencies['send']>>|undefined;
  let classified:ReturnType<typeof classifyBrokerResponse>;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   response=await Promise.race([deps.send(controller.signal),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('REQUEST_TIMEOUT'))},timeoutMs)})]);
   classified=classifyBrokerResponse(response);
  }catch{classified={ok:false,reason:controller.signal.aborted?'REQUEST_TIMEOUT':'TRANSPORT_UNAVAILABLE',retryable:true,trip:false}}
  finally{if(timer)clearTimeout(timer)}
  if(classified.ok){await deps.audit({requestId,attempt,at:now(),reason:null,httpStatus:response!.status,retryInMs:null});return {state:'KNOWN' as const,code:null,reason:null,requestId,attempts:attempt,data:classified.data}}
  if(classified.trip)await deps.openCircuit(input.sessionRevision,classified.reason);
  const retry=classified.retryable&&attempt<maxAttempts;
  const jitter=random();if(!Number.isFinite(jitter)||jitter<0||jitter>=1)throw new Error('INVALID_RETRY_JITTER');
  const requestedDelay=response?.retryAfterMs;
  const serverDelay=typeof requestedDelay==='number'&&Number.isFinite(requestedDelay)&&requestedDelay>=0?Math.min(2147483647,Math.ceil(requestedDelay)):0;
  const delay=Math.max(Math.min(30000,serverDelay),Math.min(30000,500*2**(attempt-1)+Math.floor(jitter*500)));
  // A long Retry-After must not be shortened into an early provider call.
  const deferred=serverDelay>30000;
  await deps.audit({requestId,attempt,at:now(),reason:classified.reason,httpStatus:response?.status??null,retryInMs:retry?serverDelay>30000?serverDelay:delay:null});
  if(!retry||deferred)return failure(classified.reason,attempt,serverDelay||null);
  await sleep(delay);
 }
 throw new Error('RETRY_POLICY_EXHAUSTED');
}
