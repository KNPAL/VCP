import { Queue, Worker, UnrecoverableError, type IRedisClient } from 'bullmq';
import { createHash } from 'node:crypto';
import { completedSessions, type TradingSession } from '@vcp/domain';
export const connection=()=>({host:process.env['REDIS_HOST']??'127.0.0.1',port:Number(process.env['REDIS_PORT']??6379)});
export type Handler=(data:unknown)=>Promise<unknown>;
export function createWorker(name='vcp',handlers:Record<string,Handler>={}){return new Worker(name,async job=>{const handler=handlers[job.name];if(!handler)throw new UnrecoverableError('NOT_IMPLEMENTED: '+job.name);return handler(job.data)},{connection:connection(),concurrency:1})}
export function queue(name='vcp'){return new Queue(name,{connection:connection(),defaultJobOptions:{attempts:4,backoff:{type:'exponential',delay:1000},removeOnComplete:false,removeOnFail:false}})}
export async function enqueueOnce(q:Queue,kind:string,identity:string,data:unknown){const jobId=createHash('sha256').update(kind+'|'+identity).digest('hex');return q.add(kind,data,{jobId})}
export async function scheduleFinalized(q:Queue,sessions:readonly TradingSession[]|null,asOf:string){const completed=completedSessions(sessions,asOf);if(completed.state==='UNKNOWN')return completed;for(const s of completed.value)await enqueueOnce(q,'eod',s.date,{session:s.date,finalizedAt:s.finalizedAt});return {state:'KNOWN' as const,count:completed.value.length}}
export async function acquireLease(q:Queue,name:string,ttl=30000):Promise<string|null>{const c=await q.client;const r=await evaluate(c,"if redis.call('EXISTS',KEYS[1]) == 1 then return nil end local t=redis.call('INCR',KEYS[2]);redis.call('PSETEX',KEYS[1],ARGV[1],t);return tostring(t)",2,'lease:'+name,'fence:'+name,ttl);return typeof r==='string'?r:null}
export async function renewLease(q:Queue,name:string,token:string,ttl=30000):Promise<boolean>{const c=await q.client;return await evaluate(c,"if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('PEXPIRE',KEYS[1],ARGV[2]);return 1 end return 0",1,'lease:'+name,token,ttl)===1}
export async function releaseLease(q:Queue,name:string,token:string):Promise<boolean>{const c=await q.client;return await evaluate(c,"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,'lease:'+name,token)===1}
async function evaluate(client:IRedisClient,lua:string,count:number,...args:(string|number)[]):Promise<unknown>{const name='vcp_'+createHash('sha256').update(lua).digest('hex').slice(0,16);client.defineCommand(name,{numberOfKeys:count,lua});return client.runCommand(name,args)}
