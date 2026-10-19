import type {Queue} from 'bullmq';
const script=`
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local caps={tonumber(ARGV[1]),tonumber(ARGV[2]),tonumber(ARGV[3])}
local names={'second','minute','hour'};local windows={1000,60000,3600000}
for i=1,3 do local old=redis.call('HGET',KEYS[3],names[i]);if old then caps[i]=math.min(caps[i],tonumber(old)) end;redis.call('HSET',KEYS[3],names[i],caps[i]) end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-3600000)
local wait=0
for i=1,3 do
 local count=redis.call('ZCOUNT',KEYS[1],'('..(now-windows[i]),'+inf')
 if count>=caps[i] then
  local first=redis.call('ZRANGEBYSCORE',KEYS[1],'('..(now-windows[i]),'+inf','WITHSCORES','LIMIT',count-caps[i],1)
  wait=math.max(wait,tonumber(first[2])+windows[i]-now)
 end
end
if wait>0 then return {0,wait,caps[1],caps[2],caps[3]} end
local id=redis.call('INCR',KEYS[2]);redis.call('ZADD',KEYS[1],now,tostring(id));redis.call('PEXPIRE',KEYS[1],3600001);redis.call('PEXPIRE',KEYS[2],3600001)
return {1,0,caps[1],caps[2],caps[3]}
`;
export interface ObservedQuota {verified:boolean;second:number;minute:number;hour:number}
/** Account key is a non-secret SHA256 identity. Redis owns both the clock and atomic reservation. */
export async function reserveBrokerBudget(q:Queue,accountKey:string,observed?:ObservedQuota){
 if(!/^[0-9a-f]{64}$/.test(accountKey))throw new Error('INVALID_BROKER_ACCOUNT_KEY');
 if(observed&&(!observed.verified||[observed.second,observed.minute,observed.hour].some(n=>!Number.isSafeInteger(n)||n<1)))throw new Error('INVALID_VERIFIED_QUOTA');
 const caps=[Math.min(1,observed?.second??1),Math.min(60,observed?.minute??60),Math.min(3000,observed?.hour??3000)];
 const client=await q.client;client.defineCommand('vcp_broker_budget_v1',{numberOfKeys:3,lua:script});
 const base='broker:{'+accountKey+'}';
 const result=await client.runCommand('vcp_broker_budget_v1',[base+':requests',base+':sequence',base+':caps',...caps]) as number[];
 if(!Array.isArray(result)||result.length!==5)throw new Error('GLOBAL_BUDGET_UNAVAILABLE');
 return {allowed:result[0]===1,retryAfterMs:result[1]!,caps:{second:result[2]!,minute:result[3]!,hour:result[4]!}};
}
