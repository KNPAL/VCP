import {createHash} from 'node:crypto';
import {Queue} from 'bullmq';
import {ownerStreamBinding,type PrismaClient,type LiveEntryObservation} from '@vcp/database';
import {readQuoteCache} from '@vcp/market-data';
import {readRuntimeBrokerStatus,type BrokerStatusDependencies} from './broker-status.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Server-only reader. Neither request bodies nor browser quotes can supply this evidence. */
export function entryObservationReader(db:PrismaClient,deps?:BrokerStatusDependencies){
 let queue:Queue|null=null;
 return {
  read:async(ownerId:string,listingId:string):Promise<LiveEntryObservation|null>=>{
   const binding=await ownerStreamBinding(db,ownerId);if(!binding.name||!binding.revision||!binding.sessionRevision)return null;
   const status=await readRuntimeBrokerStatus(db,ownerId,undefined,deps);if(!status.canStreamLive||!status.liveValidUntil)return null;
   if(!queue){queue=new Queue('api-entry-quotes',{connection:{host:process.env['REDIS_HOST']??'127.0.0.1',port:Number(process.env['REDIS_PORT']??6379),maxRetriesPerRequest:1,connectTimeout:1000,enableOfflineQueue:false,retryStrategy:attempt=>attempt<=2?100:null}});queue.on('error',()=>{})}
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const work=async()=>{const client=await queue!.client;return readQuoteCache(async(script,keys)=>{const name='entry_quote_'+hash(script).slice(0,16);client.defineCommand(name,{numberOfKeys:keys.length,lua:script});return client.runCommand(name,keys)},binding.name!,listingId)};
    const value=await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('QUOTE_STORE_UNAVAILABLE')),1500)})]);
    if(value.state!=='KNOWN'||!value.connectionProof||value.connectionProof.sessionRevision!==binding.sessionRevision||Date.parse(value.quote.receivedAt)<Date.parse(value.connectionProof.startedAt))return null;
    const latest=await ownerStreamBinding(db,ownerId);if(latest.revision!==binding.revision||latest.sessionRevision!==binding.sessionRevision||latest.name!==binding.name)return null;
    const validUntil=new Date(Math.min(Date.parse(status.liveValidUntil),Date.parse(value.connectionProof.validUntil),Date.parse(value.quote.validUntil))).toISOString();if(Date.parse(validUntil)<=Date.now())return null;
    return {quote:value.quote,heartbeatAt:value.connectionProof.heartbeatAt,validUntil,bindingRevision:hash([binding.revision,binding.sessionRevision]),settled:true};
   }catch{return null}finally{clearTimeout(timer)}
  },
  close:async()=>{await queue?.close()},
 };
}
