import {createHash} from 'node:crypto';
import type {Queue} from 'bullmq';
import {normalizeLiveTick,readQuoteCache,type ProviderTick,type InstrumentSnapshot,type QuoteSession} from '@vcp/market-data';
const clock="local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000);";
function keys(owner:string,listing='connection'){if(!/^[a-zA-Z0-9-]{1,100}$/.test(owner)||!/^[a-zA-Z0-9-]{1,100}$/.test(listing))throw new Error('INVALID_QUOTE_SCOPE');return ['lease:'+owner,'quotes:'+owner+':connection','quotes:'+owner+':'+listing,'quotes:'+owner+':'+listing+':watermark']}
async function run(q:Queue,lua:string,ks:string[],args:(string|number)[]){const c=await q.client,name='quote_'+createHash('sha256').update(lua).digest('hex').slice(0,16);c.defineCommand(name,{numberOfKeys:ks.length,lua});return c.runCommand(name,[...ks,...args])}
export async function recordQuoteConnection(q:Queue,owner:string,fence:string,state:'CONNECTED'|'DISCONNECTED'){
 if(!['CONNECTED','DISCONNECTED'].includes(state))throw new Error('INVALID_CONNECTION_STATE');
 return await run(q,clock+"if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end;local old=redis.call('GET',KEYS[2]);if old then old=cjson.decode(old);if old.fence==ARGV[1] and (old.state=='DISCONNECTED' or now-old.at>=30000) and ARGV[2]=='CONNECTED' then return 0 end end;redis.call('SET',KEYS[2],cjson.encode({fence=ARGV[1],state=ARGV[2],at=now}));return 1",keys(owner).slice(0,2),[fence,state])===1;
}
export async function publishLiveTick(q:Queue,owner:string,fence:string,tick:ProviderTick,mapping:InstrumentSnapshot|null,session:QuoteSession|null,receivedAt=new Date().toISOString()){
 const normalized=normalizeLiveTick(tick,mapping,session,receivedAt,true);if(normalized.state==='UNKNOWN')return normalized;
 const quote=normalized.quote;
 const result=await run(q,clock+`
 if redis.call('GET',KEYS[1])~=ARGV[1] then return 'LEASE_LOST' end
 local conn=redis.call('GET',KEYS[2]);if not conn then return 'FEED_DISCONNECTED' end
 conn=cjson.decode(conn);if conn.fence~=ARGV[1] or conn.state~='CONNECTED' or now-conn.at>=30000 then return 'FEED_DISCONNECTED' end
 local source=tonumber(ARGV[3]);local received=tonumber(ARGV[4])
 local ttl=math.min(60000-(now-source),tonumber(ARGV[6])-now)
 if received>now or source>received or ttl<=0 then return 'STALE_OR_FUTURE_TICK' end
 local old=redis.call('GET',KEYS[4])
 if old then
  old=cjson.decode(old)
  if source<old.source then return 'OUT_OF_ORDER' end
  if old.fence~=ARGV[1] then
   if source<=old.source then return 'RECONNECT_REPLAY' end
  elseif #ARGV[5]<#old.sequence or (#ARGV[5]==#old.sequence and ARGV[5]<=old.sequence) then return 'DUPLICATE_OR_OUT_OF_ORDER' end
 end
 redis.call('PSETEX',KEYS[3],ttl,cjson.encode({fence=ARGV[1],quote=cjson.decode(ARGV[2])}))
 redis.call('PSETEX',KEYS[4],172800000,cjson.encode({fence=ARGV[1],source=source,sequence=ARGV[5]}))
 return 'STORED'`,keys(owner,quote.listingId),[fence,JSON.stringify(quote),Date.parse(quote.sourceAt),Date.parse(quote.receivedAt),quote.sequence,Date.parse(session!.closesAt)]);
 return result==='STORED'?{state:'KNOWN' as const,quote}:{state:'UNKNOWN' as const,reason:String(result)};
}
export async function readLiveQuote(q:Queue,owner:string,listingId:string){return readQuoteCache((script,ks)=>run(q,script,ks,[]),owner,listingId)}
