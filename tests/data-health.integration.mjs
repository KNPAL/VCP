import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,randomInt} from 'node:crypto';
import {PrismaClient,persistInstrumentSnapshot,persistUniverse,readDataHealth,readBrokerHealth,installBrokerSession,brokerCircuitStore,persistReadiness,instrumentCoverage} from '../packages/database/dist/index.js';
test('universe health preserves unsupported segments, revisions and unknown coverage without changing evidence',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const knownAt=new Date(Date.now()-100).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10);
  const rows=['EQ','SME'].map(series=>({companyId:randomUUID(),isin:'INE'+String(randomInt(1000000000)).padStart(9,'0'),listingId:randomUUID(),exchange:'NSE',series,symbol:'SYNTHETIC_'+series,instrumentType:'EQUITY',tick:'0.05',lot:series==='EQ'?1:100,listingDate:'2020-01-01',provider:'synthetic-health',token:'12345',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}));
  const source=await persistInstrumentSnapshot(db,{knownAt,sourceReference:'synthetic-health',rows}),universe=await persistUniverse(db,{knownAt,universe:'NIFTY_500',effectiveFrom:date,effectiveTo:null,sourceReference:'synthetic-health',historicalConstituentsVerified:true,isins:rows.map(r=>r.isin)});
  const before=await db.$queryRaw`SELECT count(*)::text AS count FROM "ScanResult"`,result=await readDataHealth(db);assert.equal(result.instrumentRevision,source.id);assert.equal(result.universe.snapshotId,universe.id);assert.equal(result.universe.intended,2);assert.equal(result.members.filter(m=>m.primary).length,1);assert.equal(result.members.find(m=>m.isin===rows[1].isin).otherListings[0].series,'SME');assert.equal(result.readiness.items.length,10);assert.equal(result.executable,false);assert.ok(!JSON.stringify(result.members).includes('12345'));
  const coverage=await instrumentCoverage(db,rows[0].listingId,'synthetic-health');assert.equal(coverage.status,'UNKNOWN');assert.equal(coverage.holes,null);assert.equal(coverage.latestFinalSession,null);
  const pastSession=new Date(Date.parse(date+'T00:00:00Z')-86400000),futureSession=new Date(Date.parse(date+'T00:00:00Z')+86400000);
  for(const [session,finalizedAt] of [[pastSession,new Date(Date.now()-2000)],[futureSession,new Date(Date.now()+86400000)]]){const values={listingId:rows[0].listingId,session,open:'10',high:'11',low:'9',close:'10',volume:123n,receivedAt:new Date(Math.max(Date.now()-1000,finalizedAt.getTime())),finalizedAt};const revision=await db.candleRevision.create({data:{...values,scale:'RAW',revision:1,source:'synthetic-health'}});await db.rawDailyCandle.create({data:{...values,provider:'synthetic-health',revisionId:revision.id,contentHash:'a'.repeat(64)}})}
  assert.equal((await instrumentCoverage(db,rows[0].listingId,'synthetic-health')).latestFinalSession,pastSession.toISOString().slice(0,10));

  await persistInstrumentSnapshot(db,{knownAt:new Date(Date.now()+3600000).toISOString(),sourceReference:'future-synthetic',rows:[]});assert.equal((await readDataHealth(db)).instrumentRevision,source.id);assert.deepEqual(await db.$queryRaw`SELECT count(*)::text AS count FROM "ScanResult"`,before);
 }finally{await db.$disconnect()}
});
test('broker health uses the configured circuit only and never returns credential material',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  assert.equal((await readBrokerHealth(db)).state,'NOT_CONFIGURED');const accountKey=randomBytes(32).toString('hex');assert.equal((await readBrokerHealth(db,accountKey)).state,'UNAVAILABLE');
  const verifiedAt=new Date(Date.now()-100).toISOString(),expiresAt=new Date(Date.now()+60000).toISOString(),sessionRevision=randomUUID(),key=randomBytes(32);
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision,keyId:'health-test',expiresAt},{accessToken:'synthetic-private-token',apiKey:'synthetic-private-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt},async()=>key);
  for(const gate of ['G01','G07'])await persistReadiness(db,{gate,status:'PASS',probeAt:new Date().toISOString(),sourceAt:verifiedAt,expiresAt,sourceReference:'synthetic-health-proof',reason:null,details:{synthetic:true}});
  const result=await readBrokerHealth(db,accountKey);assert.equal(result.authenticated,true);assert.equal(result.historyReady,true);for(const value of ['synthetic-private-token','synthetic-private-key',sessionRevision,accountKey])assert.ok(!JSON.stringify(result).includes(value));
  await brokerCircuitStore(db,accountKey).openCircuit(sessionRevision,'BROKER_UNAVAILABLE');assert.equal((await readBrokerHealth(db,accountKey)).authenticated,false);
  await db.brokerCircuit.update({where:{accountKey},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await readBrokerHealth(db,accountKey)).state,'EXPIRED');assert.equal((await readBrokerHealth(db)).authenticated,false);
 }finally{await db.$disconnect()}
});
