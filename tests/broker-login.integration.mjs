import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient,saveBrokerConfiguration,beginBrokerLogin,failBrokerLogin,completeBrokerLogin,readBrokerConnection,resolveBrokerSession,logoutBroker} from '../packages/database/dist/index.js';
test('login attempts persist rate limits and fence late responses after configuration changes',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient(),key=randomBytes(32),attemptIds=[];
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,input={apiKey:'synthetic-login-key',clientCode:'T'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase()};await saveBrokerConfiguration(db,owner,input,randomUUID(),key);
  const results=await Promise.allSettled([beginBrokerLogin(db,owner),beginBrokerLogin(db,owner)]),first=results.find(r=>r.status==='fulfilled').value;attemptIds.push(first.attemptId);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/IN_PROGRESS/);assert.equal((await readBrokerConnection(db,owner)).sessionState,'AUTHENTICATING');
  assert.equal((await failBrokerLogin(db,randomUUID(),first.attemptId,'BAD_TOTP')).changed,false);await failBrokerLogin(db,owner,first.attemptId,'BAD_TOTP');assert.equal((await readBrokerConnection(db,owner)).lastErrorCode,'BAD_TOTP');
  const second=await beginBrokerLogin(db,owner);attemptIds.push(second.attemptId);await saveBrokerConfiguration(db,owner,{...input,apiKey:'synthetic-new-login-key'},randomUUID(),key);
  const binding=attempt=>({reference:randomUUID(),accountKey:attempt.accountKey,sessionRevision:randomUUID(),keyId:'login-test',expiresAt:new Date(Date.now()+60000).toISOString()}),secrets={accessToken:'synthetic-jwt',apiKey:'synthetic-provider-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},proof=()=>({authenticated:true,staticIpVerified:true,verifiedAt:new Date().toISOString()});
  const staleBinding=binding(second);await assert.rejects(completeBrokerLogin(db,owner,second.attemptId,staleBinding,secrets,proof(),async()=>key),/UNAVAILABLE/);assert.equal((await db.$queryRaw`SELECT "reference" FROM "BrokerCredential" WHERE "reference"=${staleBinding.reference}::uuid`).length,0);
  const third=await beginBrokerLogin(db,owner);attemptIds.push(third.attemptId);await new Promise(r=>setTimeout(r,5));const freshBinding=binding(third);await completeBrokerLogin(db,owner,third.attemptId,freshBinding,secrets,proof(),async()=>key);assert.equal((await readBrokerConnection(db,owner)).sessionState,'CONNECTED');assert.equal((await resolveBrokerSession(db,freshBinding.reference,async()=>key)).accountKey,third.accountKey);assert.equal((await failBrokerLogin(db,owner,third.attemptId,'BAD_CREDENTIALS')).changed,false);
  await logoutBroker(db,owner);assert.equal((await readBrokerConnection(db,owner)).sessionState,'NEEDS_LOGIN');await assert.rejects(resolveBrokerSession(db,freshBinding.reference,async()=>key),/UNAVAILABLE/);
  for(let i=0;i<2;i++){const attempt=await beginBrokerLogin(db,owner);attemptIds.push(attempt.attemptId);
   if(i===0){await logoutBroker(db,owner);const late=binding(attempt);await assert.rejects(completeBrokerLogin(db,owner,attempt.attemptId,late,secrets,proof(),async()=>key),/UNAVAILABLE/);assert.equal((await db.$queryRaw`SELECT "reference" FROM "BrokerCredential" WHERE "reference"=${late.reference}::uuid`).length,0)}
   if(i===1){await db.$executeRaw`UPDATE "BrokerLoginAttempt" SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE "id"=${attempt.attemptId}::uuid`;const expired=await readBrokerConnection(db,owner);assert.equal(expired.sessionState,'NEEDS_LOGIN');assert.equal(expired.lastErrorCode,'SESSION_EXPIRED');const lateBinding=binding(attempt);await assert.rejects(completeBrokerLogin(db,owner,attempt.attemptId,lateBinding,secrets,proof(),async()=>key),/UNAVAILABLE/);assert.equal((await db.$queryRaw`SELECT "reference" FROM "BrokerCredential" WHERE "reference"=${lateBinding.reference}::uuid`).length,0)}
   await failBrokerLogin(db,owner,attempt.attemptId,'PROVIDER_UNAVAILABLE')}

  const reconnect=new PrismaClient();try{await assert.rejects(beginBrokerLogin(reconnect,owner),/RATE_LIMITED/)}finally{await reconnect.$disconnect()}
  const events=await db.$queryRaw`SELECT e.* FROM "BrokerLoginEvent" e JOIN "BrokerLoginAttempt" a ON a."id"=e."attemptId" WHERE a."ownerId"=${owner}::uuid`;assert.ok(events.length>=10);assert.ok(!JSON.stringify(events).includes(secrets.accessToken));assert.ok(!JSON.stringify(events).includes(input.clientCode));await assert.rejects(db.$executeRaw`DELETE FROM "BrokerLoginEvent" WHERE "attemptId"=${third.attemptId}::uuid`);
 }finally{
  // Test-only rolling-window reset; fixtures never touch the application database.
  for(const id of attemptIds)await db.$executeRaw`UPDATE "BrokerLoginAttempt" SET "startedAt"=clock_timestamp()-interval '16 minutes',"expiresAt"=clock_timestamp()-interval '15 minutes' WHERE "id"=${id}::uuid`;
  key.fill(0);await db.$disconnect();
 }
});
