import type {NormalizedQuote} from './live-quotes.js';
export type QuoteCacheRunner=(script:string,keys:string[])=>Promise<unknown>;
export type QuoteConnectionProof={sessionRevision:string;heartbeatAt:string;startedAt:string;validUntil:string};
/** Shared atomic read for both protective monitoring and browser fanout. */
export async function readQuoteCache(run:QuoteCacheRunner,owner:string,listingId:string):Promise<{state:'KNOWN';quote:NormalizedQuote&{validUntil:string};connectionProof:QuoteConnectionProof|null}|{state:'UNKNOWN';reason:string}>{
 if(!/^[a-zA-Z0-9-]{1,100}$/.test(owner)||!/^[a-zA-Z0-9-]{1,100}$/.test(listingId))throw new Error('INVALID_QUOTE_SCOPE');
 const result=await run(`local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000);
 local current=redis.call('GET',KEYS[1]);local conn=redis.call('GET',KEYS[2]);local value=redis.call('GET',KEYS[3])
 if not current or not conn then return 'MONITOR_DEGRADED' end
 conn=cjson.decode(conn);if conn.fence~=current or conn.state~='CONNECTED' or now-conn.at>=30000 then return 'MONITOR_DEGRADED' end
 if not value then return 'QUOTE_UNAVAILABLE' end
 value=cjson.decode(value);if value.fence~=current then return 'MONITOR_DEGRADED' end
 local deadline=math.min(now+redis.call('PTTL',KEYS[1]),now+redis.call('PTTL',KEYS[3]),conn.at+30000)
 local proof=nil
 if conn.sessionRevision and conn.sessionRevision~='' and conn.pongAt and conn.startedAt and conn.pongAt>=conn.startedAt and conn.pongAt<=now and now-conn.pongAt<30000 then
  proof={sessionRevision=conn.sessionRevision,heartbeatAt=conn.pongAt,startedAt=conn.startedAt,validUntil=math.min(deadline,conn.pongAt+30000)}
 end
 return cjson.encode({quote=value.quote,validUntil=deadline,connectionProof=proof})`,['lease:'+owner,'quotes:'+owner+':connection','quotes:'+owner+':'+listingId]);
 const value=String(result);if(!value.startsWith('{'))return {state:'UNKNOWN',reason:value};
 const parsed=JSON.parse(value) as {quote:NormalizedQuote;validUntil:number;connectionProof?:{sessionRevision:string;heartbeatAt:number;startedAt:number;validUntil:number}};
 const p=parsed.connectionProof,connectionProof=p?{sessionRevision:p.sessionRevision,heartbeatAt:new Date(p.heartbeatAt).toISOString(),startedAt:new Date(p.startedAt).toISOString(),validUntil:new Date(p.validUntil).toISOString()}:null;
 return {state:'KNOWN',quote:{...parsed.quote,validUntil:new Date(parsed.validUntil).toISOString()},connectionProof};
}
