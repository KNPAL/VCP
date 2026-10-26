import test from 'node:test';
import {writeFile,unlink} from 'node:fs/promises';
import {createApp} from '../apps/api/dist/app.js';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PrismaClient,saveBrokerConfiguration,readBrokerConfiguration,resolveBrokerConfiguration,installBrokerSession,resolveBrokerSession} from '../packages/database/dist/index.js';
import {brokerAccountKey} from '../packages/market-data/dist/index.js';
test('encrypted owner configuration is idempotent, audited and revokes previous sessions atomically',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient(),key=randomBytes(32);
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,input={apiKey:'synthetic-key-'+randomUUID(),clientCode:'T'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase()},receipt=randomUUID();
  const before=await db.$queryRaw`SELECT (SELECT count(*) FROM "RawDailyCandle")::text AS candles,(SELECT count(*) FROM "PortfolioJournal")::text AS fills`;
  const saved=await saveBrokerConfiguration(db,owner,input,receipt,key);assert.equal((await saveBrokerConfiguration(db,owner,input,receipt,key)).revision,saved.revision);
  const concurrent=await Promise.all([1,2].map(()=>saveBrokerConfiguration(db,owner,input,randomUUID(),key)));assert.ok(concurrent.every(r=>r.revision===saved.revision));
  await assert.rejects(saveBrokerConfiguration(db,owner,{...input,apiKey:input.apiKey+'different'},receipt,key),/CONFLICT/);
  const publicValue=await readBrokerConfiguration(db,owner);assert.equal(publicValue.configured,true);assert.ok(!JSON.stringify(publicValue).includes(input.apiKey));assert.ok(!JSON.stringify(publicValue).includes(input.clientCode));assert.equal((await readBrokerConfiguration(db,randomUUID())).configured,false);
  const raw=await db.$queryRaw`SELECT "envelope" FROM "BrokerConfiguration" WHERE "ownerId"=${owner}::uuid`;assert.ok(!JSON.stringify(raw).includes(input.apiKey));assert.ok(!JSON.stringify(raw).includes(input.clientCode));assert.equal((await resolveBrokerConfiguration(db,owner,key)).apiKey,input.apiKey);await assert.rejects(resolveBrokerConfiguration(db,owner,randomBytes(32)),/UNAVAILABLE/);
  const accountKey=brokerAccountKey(input.clientCode),reference=randomUUID(),verifiedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
  await installBrokerSession(db,{reference,accountKey,sessionRevision:randomUUID(),keyId:'config-test',expiresAt},{apiKey:input.apiKey,accessToken:'synthetic-token',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt},async()=>key);
  await resolveBrokerSession(db,reference,async()=>key);const changed=await saveBrokerConfiguration(db,owner,{...input,apiKey:input.apiKey+'updated'},randomUUID(),key);assert.notEqual(changed.revision,saved.revision);await assert.rejects(resolveBrokerSession(db,reference,async()=>key),/UNAVAILABLE/);
  assert.equal((await saveBrokerConfiguration(db,owner,input,receipt,key)).revision,saved.revision);assert.equal((await readBrokerConfiguration(db,owner)).revision,changed.revision);
  const events=await db.$queryRaw`SELECT "id" FROM "BrokerConfigurationEvent" WHERE "ownerId"=${owner}::uuid AND "revision" IN (${saved.revision}::uuid,${changed.revision}::uuid)`;assert.equal(events.length,2);await assert.rejects(db.$executeRaw`DELETE FROM "BrokerConfigurationEvent" WHERE "id"=${events[0].id}::uuid`);
  const file='.runtime/config-test-'+randomUUID(),oldFile=process.env.VCP_BROKER_CONFIGURATION_KEY_FILE,oldProxy=process.env.VCP_TRUSTED_PROXY_IPS;let app;
  try{
   await writeFile(file,key,{mode:0o600});process.env.VCP_BROKER_CONFIGURATION_KEY_FILE=file;process.env.VCP_TRUSTED_PROXY_IPS='127.0.0.1';
   const hash=s=>createHash('sha256').update(s).digest('hex'),token=randomBytes(32).toString('hex'),csrf=hash('csrf:'+token),origin='https://localhost:3199',logs=[];
   await db.session.create({data:{id:hash(token),ownerId:owner,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+60000)}});
   app=await createApp({db,origin,secure:false,logSink:v=>logs.push(v)});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin,cookie:'vcp_session='+token,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':randomUUID()},body=JSON.stringify(input),url=base+'/api/v1/broker/angel-one/config';
   assert.equal((await fetch(url,{method:'PUT',headers:{origin,'content-type':'application/json'},body})).status,401);
   assert.equal((await fetch(url,{method:'PUT',headers:{...headers,'x-csrf-token':'bad','x-forwarded-proto':'https'},body})).status,403);
   assert.equal((await fetch(url,{method:'PUT',headers,body})).status,403);
   const response=await fetch(url,{method:'PUT',headers:{...headers,'x-forwarded-proto':'https'},body});assert.equal(response.status,200);assert.ok(!(await response.text()).includes(input.apiKey));
   const status=await fetch(base+'/api/v1/broker/angel-one/status',{headers});assert.equal(status.status,200);const state=await status.json();assert.equal(state.configured,true);assert.equal(state.sessionState,'NEEDS_LOGIN');assert.equal(state.canFetchHistory,false);assert.equal(state.canStreamLive,false);assert.ok(!JSON.stringify(state).includes(input.clientCode));assert.ok(!JSON.stringify(state).includes(input.apiKey));assert.ok(!JSON.stringify(logs).includes(input.apiKey));assert.ok(!JSON.stringify(logs).includes(input.clientCode));
   process.env.VCP_TRUSTED_PROXY_IPS='';const untrusted=await createApp({db,origin,secure:false,logSink:()=>{}});try{await untrusted.listen(0,'127.0.0.1');assert.equal((await fetch((await untrusted.getUrl())+'/api/v1/broker/angel-one/config',{method:'PUT',headers:{...headers,'x-forwarded-proto':'https'},body})).status,403)}finally{await untrusted.close()}
   await db.session.delete({where:{id:hash(token)}});
  }finally{await app?.close();await unlink(file).catch(()=>{});if(oldFile===undefined)delete process.env.VCP_BROKER_CONFIGURATION_KEY_FILE;else process.env.VCP_BROKER_CONFIGURATION_KEY_FILE=oldFile;if(oldProxy===undefined)delete process.env.VCP_TRUSTED_PROXY_IPS;else process.env.VCP_TRUSTED_PROXY_IPS=oldProxy}
  assert.deepEqual(await db.$queryRaw`SELECT (SELECT count(*) FROM "RawDailyCandle")::text AS candles,(SELECT count(*) FROM "PortfolioJournal")::text AS fills`,before);
 }finally{key.fill(0);await db.$disconnect()}
});
