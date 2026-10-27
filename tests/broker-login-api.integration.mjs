import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PrismaClient,saveBrokerConfiguration} from '../packages/database/dist/index.js';
import {createApp} from '../apps/api/dist/app.js';
test('HTTPS login verifies provider profile and returns metadata without retaining submitted secrets',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient(),key=randomBytes(32),oldProxy=process.env.VCP_TRUSTED_PROXY_IPS;let app,revision,owner;
 try{
  owner=(await db.owner.findFirstOrThrow()).id;const config={apiKey:'synthetic-login-api-key',clientCode:'T'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase()};revision=(await saveBrokerConfiguration(db,owner,config,randomUUID(),key)).revision;
  const hash=s=>createHash('sha256').update(s).digest('hex'),token=randomBytes(32).toString('hex'),csrf=hash('csrf:'+token),origin='https://localhost:3199',logs=[],requests=[];let rejected=false;
  const jwt=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic',pin='4926',totp='725419';
  const deps=async()=>({configurationKey:Buffer.from(key),sessionKeyId:'login-test',loadSessionKey:async()=>Buffer.from(key),network:{clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00',ipProof:{address:'192.0.2.1',verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),sourceReference:'synthetic-test'}},reserve:async()=>({allowed:true}),fetcher:async(url,options)=>{requests.push({url,options});if(rejected)return new Response('sensitive-provider-error-'+pin,{status:403});return new Response(JSON.stringify({status:true,data:url.endsWith('/loginByPassword')?{jwtToken:jwt,feedToken:'synthetic-feed-token',refreshToken:'synthetic-refresh-token'}:{clientcode:config.clientCode}}),{headers:{'content-type':'application/json'}})}});
  process.env.VCP_TRUSTED_PROXY_IPS='127.0.0.1';await db.session.create({data:{id:hash(token),ownerId:owner,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+60000)}});
  app=await createApp({db,origin,secure:false,logSink:v=>logs.push(v),brokerLoginDependencies:deps});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin,'content-type':'application/json',cookie:'vcp_session='+token,'x-csrf-token':csrf,'x-forwarded-proto':'https'},url=base+'/api/v1/broker/angel-one/login',body=JSON.stringify({pin,totp});
  assert.equal((await fetch(url,{method:'POST',headers:{origin,'content-type':'application/json'},body})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'x-csrf-token':'wrong'},body})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'x-forwarded-proto':'http'},body})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({pin,totp:'12'})})).status,422);assert.equal(requests.length,0);
  const response=await fetch(url,{method:'POST',headers,body});assert.equal(response.status,201);const result=await response.json();assert.equal(result.sessionState,'CONNECTED');assert.equal(requests.length,2);assert.deepEqual(JSON.parse(requests[0].options.body),{clientcode:config.clientCode,password:pin,totp});assert.ok(requests[1].url.endsWith('/getProfile'));
  const records=logs.map(line=>JSON.parse(line));for(const record of records)assert.deepEqual(Object.keys(record).sort(),['operation','correlationId','requestId','spanId','jobId','startedAt','finishedAt','result','failureCode','dataRevision','httpStatus'].sort());
  for(const secret of [jwt,config.apiKey,config.clientCode,'synthetic-feed-token','synthetic-refresh-token']){assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(records).includes(secret))}
  for(const record of records)for(const value of Object.values(record))assert.ok(value!==pin&&value!==totp);

  const logoutUrl=base+'/api/v1/broker/angel-one/logout';
  assert.equal((await fetch(logoutUrl,{method:'POST',headers:{...headers,'x-csrf-token':'wrong'},body:'{}'})).status,403);
  assert.equal((await fetch(logoutUrl,{method:'POST',headers:{...headers,'x-forwarded-proto':'http'},body:'{}'})).status,403);
  assert.equal((await fetch(logoutUrl,{method:'POST',headers,body:'{"unexpected":true}'})).status,400);
  for(let i=0;i<2;i++){const logout=await fetch(logoutUrl,{method:'POST',headers,body:'{}'});assert.equal(logout.status,201);const state=await logout.json();assert.equal(state.sessionState,'NEEDS_LOGIN');assert.equal(state.authenticated,false);assert.equal(state.canFetchHistory,false);assert.equal(state.canStreamLive,false);assert.equal(state.lastErrorCode,null)}
  assert.equal(requests.length,2);assert.ok(await db.session.findUnique({where:{id:hash(token)}}));
  rejected=true;const bad=await fetch(url,{method:'POST',headers,body});assert.equal(bad.status,503);assert.ok(!(await bad.text()).includes(pin));const after=await (await fetch(base+'/api/v1/broker/angel-one/status',{headers})).json();assert.equal(after.authenticated,false);assert.equal(after.lastErrorCode,'PROVIDER_UNAVAILABLE');
  const attempts=await db.$queryRaw`SELECT * FROM "BrokerLoginAttempt" WHERE "configurationRevision"=${revision}::uuid`;assert.equal(attempts.length,2);for(const secret of [jwt,config.apiKey])assert.ok(!JSON.stringify(attempts).includes(secret));for(const attempt of attempts){assert.ok(!('pin' in attempt));assert.ok(!('totp' in attempt));assert.ok(Object.values(attempt).every(v=>v!==pin&&v!==totp))}await db.session.delete({where:{id:hash(token)}});
 }finally{await app?.close();if(revision)await db.$executeRaw`UPDATE "BrokerLoginAttempt" SET "startedAt"=clock_timestamp()-interval '16 minutes',"expiresAt"=clock_timestamp()-interval '15 minutes' WHERE "configurationRevision"=${revision}::uuid`;key.fill(0);await db.$disconnect();if(oldProxy===undefined)delete process.env.VCP_TRUSTED_PROXY_IPS;else process.env.VCP_TRUSTED_PROXY_IPS=oldProxy}
});
