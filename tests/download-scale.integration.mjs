import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {permittedCalendar,permittedInstruments,permittedUniverse} from '../fixtures/reference-source.mjs';
import {persistSource,saveBrokerConfiguration,installBrokerSession,persistReadiness,readDownloadPreview,signDownloadPreview,acceptManualDownload,prepareManualDownload,readManualDownload} from '../packages/database/dist/index.js';
import {brokerAccountKey,HISTORICAL_ENDPOINT} from '../packages/market-data/dist/index.js';
test('500-stock preparation and progress share the long calendar and finish within the transaction deadline',async()=>{
 const fixture=await isolatedDatabase('download_scale'),db=fixture.db;
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,key=randomBytes(32),accountKey=brokerAccountKey('SCALETEST');
  await saveBrokerConfiguration(db,owner,{clientCode:'SCALETEST',apiKey:'synthetic'},randomUUID(),key);
  await new Promise(r=>setTimeout(r,10));
  const at=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
  const rows=Array.from({length:500},(_,i)=>({companyId:randomUUID(),listingId:randomUUID(),isin:'INE'+String(i).padStart(9,'0'),exchange:'NSE',series:'EQ',symbol:'TEST'+i,instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'ANGEL_ONE',token:String(i+1),validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}));
  await permittedInstruments(db,{knownAt:at,sourceReference:'synthetic-scale',rows});
  await permittedUniverse(db,{knownAt:at,universe:'NIFTY_500',effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-scale',historicalConstituentsVerified:true,isins:rows.map(r=>r.isin)});
  const calendar=Array.from({length:2557},(_,i)=>{const date=new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10);return {date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:at,source:'synthetic-scale',verified:true}});
  await permittedCalendar(db,calendar);const calendarId=createHash('sha256').update(JSON.stringify(calendar)).digest('hex');
  await db.calendarSnapshot.create({data:{id:calendarId,evidence:calendar}});
  await db.candleCoverage.createMany({data:rows.map(r=>({listingId:r.listingId,provider:'ANGEL_ONE',fromSession:new Date('2020-01-01'),checkedAt:new Date(at),evidence:{calendarHash:calendarId,planningCalendarHash:calendarId}}))});
  await persistSource(db,{dataset:'DAILY_CANDLES',provider:'ANGEL_ONE',endpointOrFile:HISTORICAL_ENDPOINT,licenseRef:'OWNER_DECLARED_PERSONAL_USE:'+owner+':'+at,uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:at,knownAt:at,effectiveAt:at,validUntil:expiresAt,lastVerified:at,maximumAgeMs:3600000,adjustmentPolicy:'RAW',coverage:{intended:500,available:500},error:null});
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'synthetic',expiresAt},{accessToken:'synthetic',apiKey:'synthetic',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt:at},async()=>key);
  await persistReadiness(db,{gate:'G01',status:'PASS',probeAt:at,sourceAt:at,expiresAt,sourceReference:'synthetic',reason:null,details:{synthetic:true}});
  const request={universeId:'NIFTY_500',listingIds:rows.map(r=>r.listingId),interval:'1d',fromDate:'2026-11-01',toDate:'2026-11-09',mode:'MISSING_ONLY'};
  const preview=await readDownloadPreview(db,owner,request,accountKey);
  assert.equal(preview.eligibleCount,500);assert.deepEqual(preview.warnings,[]);
  const accepted=await acceptManualDownload(db,owner,{previewToken:signDownloadPreview(preview,owner,key),mode:'MISSING_ONLY',idempotencyKey:randomUUID()},key,accountKey);
  const start=Date.now(),prepared=await prepareManualDownload(db);assert.equal(prepared.state,'RUNNING');assert.equal(prepared.children,500);assert.ok(Date.now()-start<45000,'preparation should have transaction headroom');
  const progressStart=Date.now(),detail=await readManualDownload(db,owner,accepted.runId);assert.equal(detail.progress.instruments.length,500);assert.ok(Date.now()-progressStart<5000,'progress should finish before the next poll');
  assert.equal((await prepareManualDownload(db)).state,'IDLE');
 }finally{await fixture.close()}
});
