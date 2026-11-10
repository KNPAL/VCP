import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {saveBrokerConfiguration,installBrokerSession,persistReadiness,persistSource,readBrokerHealth,getReadiness} from '../packages/database/dist/index.js';
import {brokerAccountKey,HISTORICAL_ENDPOINT} from '../packages/market-data/dist/index.js';
test('personal history access requires the matching owner, current source permission and active broker',async()=>{
 const fixture=await isolatedDatabase('personal_data'),db=fixture.db;
 try{const owner=(await db.owner.findFirstOrThrow()).id,key=randomBytes(32),clientCode='PERSONALTEST',accountKey=brokerAccountKey(clientCode),apiKey='synthetic';
 await saveBrokerConfiguration(db,owner,{clientCode,apiKey},randomUUID(),key);
 const at=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
 await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'personal-test',expiresAt},{apiKey,accessToken:'synthetic',feedToken:'synthetic-feed',clientCode,clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt:at},async()=>key);
 await persistReadiness(db,{gate:'G01',status:'PASS',probeAt:at,sourceAt:at,expiresAt,sourceReference:'synthetic',reason:null,details:{synthetic:true}});
 assert.equal((await readBrokerHealth(db,accountKey)).historyReady,false);
 const base={dataset:'DAILY_CANDLES',provider:'ANGEL_ONE',endpointOrFile:HISTORICAL_ENDPOINT,licenseRef:'OWNER_DECLARED_PERSONAL_USE:'+owner+':'+at,uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:at,knownAt:at,effectiveAt:at,validUntil:expiresAt,lastVerified:at,maximumAgeMs:60000,adjustmentPolicy:'raw',coverage:{intended:1,available:1},error:null};
 await persistSource(db,base);assert.equal((await readBrokerHealth(db,accountKey)).historyReady,true);assert.equal((await getReadiness(db)).items.find(g=>g.gate==='G07').status,'UNKNOWN');
 await new Promise(r=>setTimeout(r,5));await persistSource(db,{...base,knownAt:new Date().toISOString(),licenseRef:'OWNER_DECLARED_PERSONAL_USE:'+randomUUID()+':'+at});assert.equal((await readBrokerHealth(db,accountKey)).historyReady,false);
 await new Promise(r=>setTimeout(r,5));await persistSource(db,{...base,knownAt:new Date().toISOString(),uses:{...base.uses,DOWNLOAD:false}});assert.equal((await readBrokerHealth(db,accountKey)).historyReady,false);
 await new Promise(r=>setTimeout(r,5));await persistSource(db,{...base,knownAt:new Date().toISOString()});await persistReadiness(db,{gate:'G07',status:'FAIL',probeAt:new Date().toISOString(),sourceAt:at,expiresAt,sourceReference:'synthetic-denial',reason:'EXPLICIT_DENIAL',details:{synthetic:true}});assert.equal((await readBrokerHealth(db,accountKey)).historyReady,false);
 }finally{await fixture.close()}
});
