import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {createApp} from '../apps/api/dist/app.js';
import {readBrokerNetwork,saveBrokerConfiguration,readBrokerConnection,getReadiness} from '../packages/database/dist/index.js';
test('local configuration persists, rejects stale/unauthorized writes and connects without HTTPS',async()=>{
 const fixture=await isolatedDatabase('configuration'),db=fixture.db,key=randomBytes(32),old={NODE_ENV:process.env.NODE_ENV,VCP_ALLOW_LOCAL_BROKER_HTTP:process.env.VCP_ALLOW_LOCAL_BROKER_HTTP};let app;
 try{
  process.env.NODE_ENV='development';process.env.VCP_ALLOW_LOCAL_BROKER_HTTP='true';
  const owner=(await db.owner.findFirstOrThrow()).id,hash=s=>createHash('sha256').update(s).digest('hex'),token=randomBytes(32).toString('hex'),csrf=hash('csrf:'+token),origin='http://localhost:3199';
  await db.session.create({data:{id:hash(token),ownerId:owner,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+60000)}});
  const network={clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:11:22:33:44:55',ipProof:{address:'192.0.2.1',verifiedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),sourceReference:'synthetic test verification'}};
  const jwt=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic';let calls=0;
  await saveBrokerConfiguration(db,owner,{apiKey:'synthetic-key',clientCode:'TEST123'},crypto.randomUUID(),key);
  app=await createApp({db,origin,secure:false,logSink:()=>{},brokerLoginDependencies:async()=>({configurationKey:Buffer.from(key),sessionKeyId:'test',loadSessionKey:async()=>Buffer.from(key),network,reserve:async()=>({allowed:true}),fetcher:async url=>{calls++;return new Response(JSON.stringify({status:true,data:url.endsWith('/loginByPassword')?{jwtToken:jwt,feedToken:'synthetic-feed',refreshToken:'synthetic-refresh'}:{clientcode:'TEST123'}}),{headers:{'content-type':'application/json'}})}})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin,'content-type':'application/json',cookie:'vcp_session='+token,'x-csrf-token':csrf,'if-match':'none'},url=base+'/api/v1/configuration/network';
  assert.equal((await fetch(base+'/api/v1/configuration')).status,401);
  assert.equal((await fetch(url,{method:'PUT',headers:{...headers,'x-csrf-token':'wrong'},body:JSON.stringify(network)})).status,403);
  assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({...network,clientPublicIp:'invalid'})})).status,422);
  const saved=await fetch(url,{method:'PUT',headers,body:JSON.stringify(network)});assert.equal(saved.status,200);const value=await saved.json();assert.deepEqual((await readBrokerNetwork(db,owner)).network,network);
  const status=await (await fetch(base+'/api/v1/configuration',{headers})).json();assert.equal(status.runtime.transportAllowed,true);assert.equal(status.revision,value.revision);assert.ok(!JSON.stringify(status).includes('synthetic-key'));
  assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify(network)})).status,409);
  const login=await fetch(base+'/api/v1/broker/angel-one/login',{method:'POST',headers,body:JSON.stringify({pin:'4926',totp:'725419'})});assert.equal(login.status,201,await login.text());assert.equal(calls,2);assert.equal((await readBrokerConnection(db,owner)).sessionState,'CONNECTED');assert.equal((await getReadiness(db)).items.find(item=>item.gate==='G01').status,'PASS');assert.equal((await getReadiness(db)).items.find(item=>item.gate==='G07').status,'UNKNOWN');
  assert.equal((await fetch(url,{method:'PUT',headers:{...headers,'if-match':value.revision},body:JSON.stringify({...network,macAddress:'00:11:22:33:44:66'})})).status,200);assert.equal((await readBrokerConnection(db,owner)).sessionState,'NEEDS_LOGIN');assert.equal((await getReadiness(db)).items.find(item=>item.gate==='G01').status,'UNKNOWN');
 }finally{await app?.close();await fixture.close();key.fill(0);for(const [name,value] of Object.entries(old))if(value===undefined)delete process.env[name];else process.env[name]=value}
});
