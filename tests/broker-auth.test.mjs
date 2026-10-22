import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateBroker,brokerAccountKey} from '../packages/market-data/dist/index.js';
const now=()=> '2026-10-18T12:00:00Z',login={clientCode:'TEST123',pin:'1234',totp:'123456',apiKey:'synthetic-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'};
const proof={address:login.clientPublicIp,sourceReference:'synthetic-registered-ip',verifiedAt:'2026-10-18T00:00:00Z',expiresAt:'2026-10-20T00:00:00Z'};
const token=exp=>'e30.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.synthetic';
const jwt=token(Date.parse('2026-10-19T12:00:00Z')/1000);
const json=data=>new Response(JSON.stringify({status:true,data}),{headers:{'content-type':'application/json'}});
function fixture(response){let count=0,reservations=0;const requests=[];return {requests,reservations:()=>reservations,deps:{now,reserve:async()=>{reservations++;return {allowed:true}},fetcher:async(url,options)=>{requests.push({url,options});return response?response(count++):count++===0?json({jwtToken:jwt,refreshToken:'unused-refresh'}):json({clientcode:login.clientCode})}}}}
test('login and profile are independently budgeted; verified sessions expire by exchange midnight',async()=>{
 const f=fixture(),result=await authenticateBroker(login,proof,f.deps);assert.equal(f.reservations(),2);assert.equal(result.accountKey,brokerAccountKey(login.clientCode));assert.equal(result.expiresAt,'2026-10-18T18:30:00.000Z');assert.equal(result.secrets.accessToken,jwt);assert.ok(!JSON.stringify(result).includes('unused-refresh'));assert.ok(!('pin' in result.secrets));
 assert.ok(f.requests[0].url.endsWith('/loginByPassword'));assert.ok(f.requests[1].url.endsWith('/getProfile'));assert.ok(f.requests.every(r=>r.options.redirect==='error'));assert.equal(f.requests[1].options.headers.Authorization,'Bearer '+jwt);
});
test('invalid or unknown static IP proof blocks requests before quota reservation',async()=>{
 for(const patch of [{address:'192.0.2.2'},{sourceReference:''},{expiresAt:now()},{verifiedAt:'2027-01-01T00:00:00Z'}]){const f=fixture();await assert.rejects(authenticateBroker(login,{...proof,...patch},f.deps),/BROKER_UNAVAILABLE/);assert.equal(f.requests.length,0);assert.equal(f.reservations(),0)}
});
test('verified login retains feed credentials only as a complete encrypted-session input',async()=>{
 const f=fixture(i=>i===0?json({jwtToken:jwt,feedToken:'synthetic-feed'}):json({clientcode:login.clientCode}));
 const result=await authenticateBroker(login,proof,f.deps);assert.equal(result.secrets.clientCode,login.clientCode);assert.equal(result.secrets.feedToken,'synthetic-feed');
 const bad=fixture(i=>i===0?json({jwtToken:jwt,feedToken:'bad\r\nheader'}):json({clientcode:login.clientCode}));assert.equal((await authenticateBroker(login,proof,bad.deps)).secrets.feedToken,undefined);
});
test('403, HTML, null, provider error and mismatched account never establish a session',async()=>{
 const bad=[()=>new Response('secret',{status:403}),()=>new Response('<html>secret</html>',{headers:{'content-type':'text/html'}}),()=>new Response('null',{headers:{'content-type':'application/json'}}),()=>new Response('{"status":false,"data":{}}',{headers:{'content-type':'application/json'}})];
 for(const response of bad){const f=fixture(response);await assert.rejects(authenticateBroker(login,proof,f.deps),error=>error.message==='BROKER_UNAVAILABLE');assert.equal(f.requests.length,1)}
 const f=fixture(i=>i===0?json({jwtToken:jwt}):json({clientcode:'OTHER123'}));await assert.rejects(authenticateBroker(login,proof,f.deps),/BROKER_UNAVAILABLE/);
});
test('expired claims and bounded timeout fail closed without leaking transport errors',async()=>{
 const f=fixture(i=>i===0?json({jwtToken:token(Date.parse(now())/1000)}):json({clientcode:login.clientCode}));await assert.rejects(authenticateBroker(login,proof,f.deps),/BROKER_UNAVAILABLE/);
 let signal;await assert.rejects(authenticateBroker(login,proof,{now,timeoutMs:10,reserve:async()=>({allowed:true}),fetcher:async(_url,options)=>{signal=options.signal;return new Promise(()=>{})}}),/BROKER_UNAVAILABLE/);assert.equal(signal.aborted,true);
 const denied=fixture();await assert.rejects(authenticateBroker(login,proof,{...denied.deps,reserve:async()=>({allowed:false})}),/BROKER_UNAVAILABLE/);assert.equal(denied.requests.length,0);
});

