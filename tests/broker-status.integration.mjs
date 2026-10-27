import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient,saveBrokerConfiguration,installBrokerSession,persistReadiness,logoutBroker,beginBrokerLogin,failBrokerLogin} from '../packages/database/dist/index.js';
import {brokerAccountKey} from '../packages/market-data/dist/index.js';
import {readRuntimeBrokerStatus,networkStatus} from '../apps/api/dist/broker-status.js';
test('runtime status reports configuration, verified IP, expiry and gated live capabilities without exposing secrets',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient(),key=randomBytes(32);let attempt;
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,clientCode='T'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),apiKey='synthetic-status-key',accountKey=brokerAccountKey(clientCode);
  const before=await db.$queryRaw`SELECT (SELECT count(*) FROM "RawDailyCandle")::text AS candles,(SELECT count(*) FROM "PortfolioJournal")::text AS fills`;
  const expiresAt=new Date(Date.now()+60000).toISOString(),network={clientPublicIp:'192.0.2.1',ipProof:{address:'192.0.2.1',verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt,sourceReference:'synthetic-status-proof'}};
  const deps={configurationKey:async()=>Buffer.from(key),network:async()=>network,loadSessionKey:async()=>Buffer.from(key),liveEnabled:true};
  const read=(override={})=>readRuntimeBrokerStatus(db,owner,undefined,{...deps,...override});
  assert.equal((await readRuntimeBrokerStatus(db,randomUUID(),undefined,deps)).sessionState,'NOT_CONFIGURED');
  await saveBrokerConfiguration(db,owner,{apiKey,clientCode},randomUUID(),key);assert.equal((await read()).sessionState,'NEEDS_LOGIN');assert.equal((await read()).serverPublicIpDisplayOrNull,'192.0.2.1');
  const bad=await read({configurationKey:async()=>randomBytes(32)});assert.equal(bad.sessionState,'CONFIG_ERROR');assert.equal(bad.lastErrorCode,'APP_CONFIG_INVALID');assert.equal(bad.canStreamLive,false);
  await new Promise(r=>setTimeout(r,5));
  const reference=randomUUID(),sessionRevision=randomUUID(),verifiedAt=new Date().toISOString(),secrets={apiKey,accessToken:'synthetic-status-jwt',refreshToken:'synthetic-status-refresh',feedToken:'synthetic-status-feed',clientCode,clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'};
  await installBrokerSession(db,{reference,accountKey,sessionRevision,keyId:'status-test',expiresAt},secrets,{authenticated:true,staticIpVerified:true,verifiedAt},async()=>key);
  for(const gate of ['G01','G07','G09'])await persistReadiness(db,{gate,status:'PASS',probeAt:new Date().toISOString(),sourceAt:verifiedAt,expiresAt,sourceReference:'synthetic-status-proof',reason:null,details:{synthetic:true}});
  const connected=await read();assert.equal(connected.sessionState,'CONNECTED');assert.equal(connected.canFetchHistory,true);assert.equal(connected.canStreamLive,true);assert.equal(connected.permissions.orders,false);
  for(const secret of [apiKey,clientCode,secrets.accessToken,secrets.refreshToken,secrets.feedToken,reference,accountKey])assert.ok(!JSON.stringify(connected).includes(secret));
  assert.equal((await read({liveEnabled:false})).canStreamLive,false);
  assert.equal((await read({loadSessionKey:async()=>randomBytes(32)})).sessionState,'UNAVAILABLE');
  const expired=await read({network:async()=>({...network,ipProof:{...network.ipProof,verifiedAt:'2020-01-01T00:00:00Z',expiresAt:'2020-01-02T00:00:00Z'}})});assert.equal(expired.staticIpStatus,'EXPIRED');assert.equal(expired.serverPublicIpDisplayOrNull,null);assert.equal(expired.canFetchHistory,false);assert.equal(expired.canStreamLive,false);assert.equal(expired.lastErrorCode,'STATIC_IP_NOT_VERIFIED');
  const changed=await read({network:async()=>({...network,clientPublicIp:'192.0.2.2',ipProof:{...network.ipProof,address:'192.0.2.2'}})});assert.equal(changed.canStreamLive,false);assert.equal(changed.canFetchHistory,false);
  for(const status of ['FAIL','PASS']){await persistReadiness(db,{gate:'G07',status,probeAt:new Date().toISOString(),sourceAt:verifiedAt,expiresAt,sourceReference:'synthetic-status-proof',reason:status==='FAIL'?'LICENSE_DENIED':null,details:{synthetic:true}});if(status==='FAIL'){assert.equal((await read()).canStreamLive,false);assert.equal((await read()).canFetchHistory,false)}}
  const {feedToken,clientCode:unusedClient,...historySecrets}=secrets;assert.ok(feedToken&&unusedClient);
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'status-test',expiresAt},historySecrets,{authenticated:true,staticIpVerified:true,verifiedAt:new Date().toISOString()},async()=>key);
  assert.equal((await read()).canFetchHistory,true);assert.equal((await read()).canStreamLive,false);
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'status-test',expiresAt},secrets,{authenticated:true,staticIpVerified:true,verifiedAt:new Date().toISOString()},async()=>key);assert.equal((await read()).canStreamLive,true);
  await persistReadiness(db,{gate:'G09',status:'FAIL',probeAt:new Date().toISOString(),sourceAt:verifiedAt,expiresAt,sourceReference:'synthetic-status-proof',reason:'HEARTBEAT_UNAVAILABLE',details:{synthetic:true}});assert.equal((await read()).canStreamLive,false);
  // Expiry survives a new client; no process-local session state is trusted.
  await db.$executeRaw`UPDATE "BrokerCircuit" SET "open"=false,"reason"=NULL,"expiresAt"=clock_timestamp()-interval '1 second' WHERE "accountKey"=${accountKey}`;
  const restarted=new PrismaClient();try{const state=await readRuntimeBrokerStatus(restarted,owner,undefined,deps);assert.equal(state.sessionState,'EXPIRED');assert.equal(state.canStreamLive,false);assert.equal(state.lastErrorCode,'SESSION_EXPIRED')}finally{await restarted.$disconnect()}
  await logoutBroker(db,owner);assert.equal((await read()).sessionState,'NEEDS_LOGIN');assert.equal((await read()).canFetchHistory,false);
  attempt=await beginBrokerLogin(db,owner);await failBrokerLogin(db,owner,attempt.attemptId,'APP_CONFIG_INVALID');assert.equal((await read()).sessionState,'CONFIG_ERROR');
  await saveBrokerConfiguration(db,owner,{apiKey:apiKey+'new',clientCode},randomUUID(),key);
  // A replacement configuration always requires login even if an old session existed.
  assert.equal((await read()).sessionState,'NEEDS_LOGIN');
  assert.deepEqual(await db.$queryRaw`SELECT (SELECT count(*) FROM "RawDailyCandle")::text AS candles,(SELECT count(*) FROM "PortfolioJournal")::text AS fills`,before);
 }finally{if(attempt)await db.$executeRaw`UPDATE "BrokerLoginAttempt" SET "startedAt"=clock_timestamp()-interval '16 minutes',"expiresAt"=clock_timestamp()-interval '15 minutes' WHERE "id"=${attempt.attemptId}::uuid`;key.fill(0);await db.$disconnect()}
});
test('network display requires an actual current matching IP proof',()=>{
 for(const value of [null,{}, {clientPublicIp:'secret-token',ipProof:{}},{clientPublicIp:'192.0.2.1',ipProof:{address:'192.0.2.2',verifiedAt:'2020-01-01',expiresAt:'2099-01-01',sourceReference:'test'}}])assert.equal(networkStatus(value).serverPublicIpDisplayOrNull,null);
});
