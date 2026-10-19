import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
export type LogOperation='api.request'|'api.startup'|'worker.job'|'worker.poll'|'worker.error'|'broker.history'|'broker.auth'|'feed'|'alert.delivery';
export type LogSink=(line:string)=>void;
export interface LogContext {correlationId:string;requestId:string|null;spanId:string;jobId:string|null}
const contexts=new AsyncLocalStorage<{context:LogContext;sink:LogSink}>();
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const codes=new Set(['INTERNAL_ERROR','INVALID_INPUT','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','STALE_CONFLICT','DOMAIN_REJECTED','NOT_IMPLEMENTED','RATE_LIMITED','BROKER_UNAVAILABLE','AUTH_REJECTED','AUTH_CIRCUIT_OPEN','BROKER_SESSION_CHANGED','BROKER_TRANSIENT','BROKER_REJECTED','INVALID_BROKER_RESPONSE','TRANSPORT_UNAVAILABLE','REQUEST_TIMEOUT','GLOBAL_BUDGET_UNAVAILABLE','BROKER_PREREQUISITE_UNKNOWN','DATA_INCOMPLETE','BLOCKED_DATA','WORKER_ERROR','WORKER_DEPENDENCY_UNAVAILABLE','REQUEST_ABORTED','STALE_SYNC_LEASE','BACKFILL_CONTEXT_UNAVAILABLE']);
const defaultSink:LogSink=line=>process.stdout.write(line+'\n');
const operations=new Set(['api.request','api.startup','worker.job','worker.poll','worker.error','broker.history','broker.auth','feed','alert.delivery']);
export function logContext(){return contexts.getStore()?.context??null}
export function withLogContext<T>(input:{requestId?:string;jobIdentity?:string;sink?:LogSink},work:()=>T):T{
 const requestId=uuid(input.requestId)?input.requestId:null,jobId=input.jobIdentity?createHash('sha256').update(input.jobIdentity).digest('hex'):null;
 const context={correlationId:requestId??randomUUID(),requestId,spanId:randomUUID(),jobId};
 return contexts.run({context,sink:input.sink??defaultSink},work);
}
/** Closed schema: raw paths, payloads, headers, exceptions, messages and credentials are never serialized. */
export function writeLog(operation:LogOperation,input:{startedAt:string;finishedAt:string|null;result:'STARTED'|'SUCCESS'|'UNKNOWN'|'FAILED';failureCode?:string|null;dataRevision?:unknown;httpStatus?:number},context=logContext(),sink?:LogSink){
 const safeContext={correlationId:uuid(context?.correlationId)?context.correlationId:randomUUID(),requestId:uuid(context?.requestId)?context.requestId:null,spanId:uuid(context?.spanId)?context.spanId:randomUUID(),jobId:typeof context?.jobId==='string'&&/^[0-9a-f]{64}$/.test(context.jobId)?context.jobId:null};
 const instant=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
 const record={operation:operations.has(operation)?operation:'worker.error',...safeContext,startedAt:instant(input.startedAt),finishedAt:instant(input.finishedAt),result:['STARTED','SUCCESS','UNKNOWN','FAILED'].includes(input.result)?input.result:'FAILED',failureCode:input.failureCode?codes.has(input.failureCode)?input.failureCode:'INTERNAL_ERROR':null,dataRevision:typeof input.dataRevision==='string'&&/^[0-9a-f]{64}$/.test(input.dataRevision)?input.dataRevision:null,httpStatus:Number.isInteger(input.httpStatus)&&input.httpStatus!>=100&&input.httpStatus!<=599?input.httpStatus:null};
 try{(sink??contexts.getStore()?.sink??defaultSink)(JSON.stringify(record))}catch{/* Logging failures cannot stop protective evaluation or requests. */}
}
export async function trace<T>(operation:LogOperation,work:()=>Promise<T>):Promise<T>{
 const inherited=contexts.getStore(),context=inherited?{...inherited.context,spanId:randomUUID()}:{correlationId:randomUUID(),requestId:null,spanId:randomUUID(),jobId:null};
 return contexts.run({context,sink:inherited?.sink??defaultSink},async()=>{
  const startedAt=new Date().toISOString();writeLog(operation,{startedAt,finishedAt:null,result:'STARTED'});
  try{
   const result=await work(),value=result&&typeof result==='object'?result as Record<string,unknown>:{};
   const outcome=value['state']==='UNKNOWN'?'UNKNOWN':value['state']==='FAILED'?'FAILED':'SUCCESS';
   writeLog(operation,{startedAt,finishedAt:new Date().toISOString(),result:outcome,failureCode:outcome==='SUCCESS'?null:typeof value['reason']==='string'?value['reason']:'INTERNAL_ERROR',dataRevision:value['dataRevision']});return result;
  }catch(error){writeLog(operation,{startedAt,finishedAt:new Date().toISOString(),result:'FAILED',failureCode:error instanceof Error?error.message:'INTERNAL_ERROR'});throw error}
 });
}
