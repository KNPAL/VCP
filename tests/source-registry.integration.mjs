import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,randomBytes,createHash} from 'node:crypto';
import {PrismaClient,persistSource,readSourceRegistry,currentSource,persistInstrumentSnapshot,createSyncRun,backfillContext,installBrokerSession,bindBackfill} from '../packages/database/dist/index.js';
import {HISTORICAL_ENDPOINT} from '../packages/market-data/dist/index.js';
import {createApp} from '../apps/api/dist/app.js';
import {masterFixture} from '../fixtures/instrument-master.mjs';
import {backfillHandler} from '../apps/worker/dist/backfill-delivery.js';
test('registry retains denials, rejects malformed grants and fences superseded backfill sources',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();let app;
 try{
  const now=new Date().toISOString(),source={...masterFixture(now).source,dataset:'DAILY_CANDLES',provider:'ANGEL_ONE',endpointOrFile:HISTORICAL_ENDPOINT,uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false}},grant=await persistSource(db,source);
  assert.equal((await currentSource(db,source,now)).id,grant.id);assert.equal((await readSourceRegistry(db,'missing-'+randomUUID(),now)).state,'UNKNOWN');
  assert.equal((await readSourceRegistry(db,source.dataset,now)).items.find(item=>item.id===grant.id).permissions.STORE.status,'PASS');
  await assert.rejects(persistSource(db,{...source,uses:{...source.uses,STORE:'true'}}),/INVALID_SOURCE_PERMISSIONS/);
  const listingId=randomUUID(),mapping=await persistInstrumentSnapshot(db,{knownAt:now,sourceReference:'synthetic-registry',rows:[{...masterFixture(now).mappings[0],listingId,companyId:randomUUID(),isin:'INE'+String(randomInt(1000000000)).padStart(9,'0'),provider:'ANGEL_ONE'}]});
  const date='2026-01-02',calendar=[{date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic-calendar',verified:true}],runId=randomUUID();
  await createSyncRun(db,{id:runId,listingId,provider:'ANGEL_ONE',from:date,to:date,asOf:now,calendar,windows:[{from:date,to:date,sessions:[date]}]});
  const binding={runId,credentialReference:randomUUID(),instrumentSnapshotId:mapping.id,sourceSnapshotId:grant.id,exchange:'NSE',symbolToken:'123'};await backfillContext(db,binding,now);
  const deniedAt=new Date(Date.now()+1).toISOString(),denied=await persistSource(db,{...source,knownAt:deniedAt,uses:{...source.uses,STORE:false,DISPLAY:false}});
  await assert.rejects(backfillContext(db,binding,deniedAt),/BACKFILL_SOURCE_SUPERSEDED/);
  const key=randomBytes(32);await installBrokerSession(db,{reference:binding.credentialReference,accountKey:randomBytes(32).toString('hex'),sessionRevision:randomUUID(),keyId:'synthetic-registry',expiresAt:source.validUntil},{apiKey:'synthetic',accessToken:'synthetic',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt:now},async()=>key,now);
  await bindBackfill(db,binding,now);let observationTime=now,requests=0;
  const handler=backfillHandler(db,{},async()=>key,()=>observationTime,()=>({fetch:async()=>{requests++;observationTime=deniedAt;return []}}));
  const attempted=await handler({runId});assert.equal(requests,1);assert.equal(attempted.state,'FAILED');assert.equal(attempted.reason,'BACKFILL_SOURCE_SUPERSEDED');
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS count FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid`)[0].count,0);key.fill(0);
  const latest=await readSourceRegistry(db,source.dataset,deniedAt),item=latest.items.find(item=>item.id===denied.id);assert.equal(item.permissions.STORE.status,'FAIL');assert.equal(item.permissions.DISPLAY.status,'FAIL');assert.equal(item.permissions.DOWNLOAD.status,'PASS');assert.ok(!latest.items.some(item=>item.id===grant.id));
  assert.equal((await currentSource(db,source,now)).id,grant.id,'Historical cutoff cannot observe later revocation');
  assert.equal((await readSourceRegistry(db,source.dataset,source.validUntil)).items.find(item=>item.id===denied.id).permissions.DOWNLOAD.status,'UNKNOWN');
  assert.deepEqual(await persistSource(db,source),grant);await assert.rejects(db.$executeRaw`DELETE FROM "SourceSnapshot" WHERE "id"=${grant.id}`);
  const owner=await db.owner.findFirstOrThrow(),token=randomBytes(32).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');await db.session.create({data:{id:hash(token),ownerId:owner.id,csrfHash:hash('unused'),expiresAt:new Date(Date.now()+60000)}});
  app=await createApp({db,secure:false,origin:'http://127.0.0.1:3199',logSink:()=>{}});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={cookie:'vcp_session='+token};
  assert.equal((await fetch(base+'/api/v1/sources/registry')).status,401);assert.equal((await fetch(base+'/api/v1/sources/registry?dataset=',{headers})).status,400);
  const response=await fetch(base+'/api/v1/sources/registry?dataset=DAILY_CANDLES',{headers});assert.equal(response.status,200);assert.equal((await response.json()).items.find(item=>item.id===denied.id).permissions.STORE.status,'FAIL');
 }finally{await app?.close();await db.$disconnect()}
});
