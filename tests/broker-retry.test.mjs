import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalRequest,classifyBrokerResponse,historicalTransport} from '../packages/market-data/dist/index.js';
const input={sessionRevision:'session-1',staticIpVerified:true,downloadAllowed:true};
const good={status:200,contentType:'application/json',body:JSON.stringify({status:true,data:[]})};
function fixture(responses){
 const calls=[],audits=[],delays=[];let circuit={sessionRevision:'session-1',open:false,expiresAt:'2026-10-19T00:00:00Z'},budget=0;
 const deps={now:()=> '2026-10-18T12:00:00Z',random:()=>0.5,sleep:async ms=>{delays.push(ms)},readCircuit:async()=>circuit,openCircuit:async()=>{circuit={...circuit,open:true}},audit:async event=>{audits.push(event)},acquireBudget:async()=>{budget++;return {allowed:true,retryAfterMs:0}},send:async()=>{const response=responses[Math.min(calls.length,responses.length-1)];calls.push(true);if(response instanceof Error)throw response;return response}};
 return {deps,calls,audits,delays,budget:()=>budget};
}
test('transient retries are bounded, budgeted individually, jittered, and audited without raw errors',async()=>{
 const f=fixture([{...good,status:429,body:'secret html'},new Error('secret token'),good]);
 const result=await historicalRequest(input,f.deps);assert.equal(result.state,'KNOWN');assert.equal(result.attempts,3);assert.equal(f.budget(),3);assert.deepEqual(f.delays,[750,1250]);assert.ok(!JSON.stringify(f.audits).includes('secret'));
 const exhausted=fixture([{...good,status:503}]);assert.equal((await historicalRequest(input,exhausted.deps)).attempts,4);assert.equal(exhausted.calls.length,4);assert.equal(exhausted.delays.length,3);
});

test('historical transport permits only bounded cash-equity daily requests and refuses redirects',async()=>{
 const window={exchange:'NSE',symbolToken:'123',from:'2026-10-01',to:'2026-10-18'};
 const secrets={accessToken:'synthetic-token',apiKey:'synthetic-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'};
 let request;
 const send=historicalTransport(window,secrets,async(url,options)=>{request={url,options};return new Response(good.body,{status:200,headers:{'content-type':'application/json'}})});
 const result=await send(new AbortController().signal);assert.equal(classifyBrokerResponse(result).ok,true);
 assert.equal(request.url,'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData');assert.equal(request.options.redirect,'error');assert.equal(JSON.parse(request.options.body).interval,'ONE_DAY');assert.ok(!JSON.stringify(result).includes('synthetic-token'));
 assert.throws(()=>historicalTransport({...window,from:'2020-01-01'},secrets),/INVALID_HISTORICAL_WINDOW/);
 assert.throws(()=>historicalTransport({...window,exchange:'NFO'},secrets),/INVALID_HISTORICAL_WINDOW/);
});
test('unauthorized, null and HTML open the circuit and prohibit subsequent provider calls',async()=>{
 for(const response of [{...good,status:403},{...good,body:'null'},{...good,contentType:'text/html',body:'<html>login</html>'},{...good,body:JSON.stringify({status:false,errorcode:'AG8001',data:null})}]){
  const f=fixture([response]);assert.equal((await historicalRequest(input,f.deps)).state,'UNKNOWN');assert.equal(f.calls.length,1);
  assert.equal((await historicalRequest(input,f.deps)).reason,'AUTH_CIRCUIT_OPEN');assert.equal(f.calls.length,1);
 }
});
test('long Retry-After returns control without an early retry; missing prerequisites and budgets fail closed',async()=>{
 const f=fixture([{...good,status:429,retryAfterMs:60000}]);assert.equal((await historicalRequest(input,f.deps)).reason,'RATE_LIMITED');assert.equal(f.delays.length,0);assert.equal(f.calls.length,1);assert.equal(f.audits[0].retryInMs,60000);
 const blocked=fixture([good]);assert.equal((await historicalRequest({...input,staticIpVerified:false},blocked.deps)).attempts,0);assert.equal(blocked.calls.length,0);
 assert.equal((await historicalRequest(input,{...blocked.deps,acquireBudget:async()=>({allowed:false,retryAfterMs:1000})})).reason,'RATE_LIMITED');assert.equal(blocked.calls.length,0);
 assert.equal((await historicalRequest(input,{...blocked.deps,acquireBudget:async()=>{throw new Error('Redis down')}})).reason,'GLOBAL_BUDGET_UNAVAILABLE');
});
test('timeouts abort hanging transports and session changes prevent stale retries',async()=>{
 const f=fixture([good]);let aborted=false;
 const timeout=await historicalRequest({...input,maxAttempts:1,timeoutMs:10},{...f.deps,send:signal=>new Promise(()=>{signal.addEventListener('abort',()=>{aborted=true})})});
 assert.equal(timeout.reason,'REQUEST_TIMEOUT');assert.equal(aborted,true);
 assert.equal((await historicalRequest({...input,sessionRevision:'old'},f.deps)).reason,'BROKER_SESSION_CHANGED');assert.equal(f.calls.length,0);
 assert.equal((await historicalRequest({...input,timeoutMs:10},{...f.deps,acquireBudget:()=>new Promise(()=>{})})).reason,'GLOBAL_BUDGET_UNAVAILABLE');assert.equal(f.calls.length,0);
});
test('empty data remains empty and provider errors are never coerced to successful candles',()=>{
 assert.deepEqual(classifyBrokerResponse(good),{ok:true,data:[]});
 assert.equal(classifyBrokerResponse({...good,body:'{"status":true,"data":null}'}).trip,true);
 assert.equal(classifyBrokerResponse({...good,body:'{"status":false,"errorcode":"AB1004","data":null}'}).retryable,true);
 assert.equal(classifyBrokerResponse({...good,status:404}).retryable,false);
});
