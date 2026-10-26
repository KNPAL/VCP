import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {createApp} from '../apps/api/dist/app.js';
import {randomUUID,randomInt,randomBytes,createHash} from 'node:crypto';
import {PrismaClient,persistInstrumentSnapshot,persistUniverse,persistSource,ingestCandles,readDownloadPreview,validateDownloadPreviewRequest,verifyDownloadPreview,signDownloadPreview,acceptManualDownload,prepareManualDownload,readManualDownload,installBrokerSession,persistReadiness} from '../packages/database/dist/index.js';
import {HISTORICAL_ENDPOINT} from '../packages/market-data/dist/index.js';
test('persisted preview binds revisions, preserves gaps and denies restricted sources without dispatch',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const owner=(await db.owner.findFirstOrThrow()).id,listingId=randomUUID(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0'),knownAt=new Date(Date.now()-1000).toISOString(),until=new Date(Date.now()+3600000).toISOString();
  const row={companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'SYNTHETIC_PREVIEW',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'ANGEL_ONE',token:'12345',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true};
  await persistInstrumentSnapshot(db,{knownAt,sourceReference:'synthetic-preview',rows:[row]});await persistUniverse(db,{knownAt,universe:'NIFTY_500',effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-preview',historicalConstituentsVerified:true,isins:[isin]});
  const source={dataset:'DAILY_CANDLES',provider:'ANGEL_ONE',endpointOrFile:HISTORICAL_ENDPOINT,licenseRef:'synthetic-test-only',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:knownAt,knownAt,effectiveAt:knownAt,validUntil:until,lastVerified:knownAt,maximumAgeMs:3600000,adjustmentPolicy:'RAW',coverage:{intended:1,available:1},error:null};await persistSource(db,source);
  const calendar=['2025-01-01','2025-01-02','2025-01-03'].map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2024-12-01T00:00:00Z',source:'synthetic',verified:true}));
  const bars=calendar.filter((_,i)=>i!==1).map(d=>({listingId,provider:'ANGEL_ONE',session:d.date,open:'10',high:'11',low:'9',close:'10',volume:'100',receivedAt:knownAt,finalizedAt:d.finalizedAt,zeroVolumeVerified:false}));
  const request={universeId:'NIFTY_500',listingIds:[listingId],interval:'1d',fromDate:'2025-01-01',toDate:'2025-01-03',mode:'MISSING_ONLY'};
  await ingestCandles(db,{bars,calendar,from:request.fromDate,to:request.toDate,asOf:knownAt,listingId,provider:'ANGEL_ONE'});
  const counts=()=>db.$queryRaw`SELECT (SELECT count(*) FROM "HistoricalSyncRun")::text AS runs,(SELECT count(*) FROM "RawDailyCandle")::text AS candles`;
  const before=await counts(),preview=await readDownloadPreview(db,owner,request);assert.equal(preview.items.length,1);assert.equal(preview.alreadyStoredCount,2);assert.equal(preview.missingCount,1);assert.equal(preview.executable,false);assert.equal(Date.parse(preview.expiresAt)-Date.parse(preview.checkedAt),300000);assert.match(preview.previewId,/^[a-f0-9]{64}$/);assert.ok(preview.warnings.includes('BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'));assert.ok(!JSON.stringify(preview).includes('12345'));assert.deepEqual(await counts(),before);
  const again=await readDownloadPreview(db,owner,request);assert.equal(again.dataRevision,preview.dataRevision);
  const newTime=new Date().toISOString();await ingestCandles(db,{bars:[{...bars[0],close:'10.5',receivedAt:newTime}],calendar,from:request.fromDate,to:request.toDate,asOf:newTime,listingId,provider:'ANGEL_ONE'});assert.notEqual((await readDownloadPreview(db,owner,request)).dataRevision,preview.dataRevision);
  const unsupported=await readDownloadPreview(db,owner,{...request,listingIds:[randomUUID()]});assert.equal(unsupported.items.length,0);assert.equal(unsupported.missingCount,null);assert.equal(unsupported.blockedInstruments[0].reason,'NOT_CANONICAL_UNIVERSE_LISTING');
  const keyFile='.runtime/preview-key-test-'+randomUUID(),signingKey=randomBytes(32),priorKey=process.env.VCP_DOWNLOAD_PREVIEW_KEY_FILE,origin='http://localhost:3199';let app;
  try{
   await writeFile(keyFile,signingKey,{mode:0o600});process.env.VCP_DOWNLOAD_PREVIEW_KEY_FILE=keyFile;
   const hash=s=>createHash('sha256').update(s).digest('hex'),sessionToken=randomBytes(32).toString('hex'),csrf=hash('csrf:'+sessionToken);
   await db.session.create({data:{id:hash(sessionToken),ownerId:owner,csrfHash:hash(csrf),expiresAt:new Date(Date.now()+60000)}});
   app=await createApp({db,origin,secure:false,logSink:()=>{}});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin,'content-type':'application/json',cookie:'vcp_session='+sessionToken,'x-csrf-token':csrf};
   const submit=()=>fetch(base+'/api/v1/history/downloads/preview',{method:'POST',headers,body:JSON.stringify(request)});
   const signed=await submit();assert.equal(signed.status,201);const result=await signed.json();assert.equal(result.authorization,'SIGNED');assert.equal(verifyDownloadPreview(result.previewToken,owner,signingKey).request.mode,'MISSING_ONLY');assert.equal(result.executable,false);
   assert.ok(!JSON.stringify(result).includes(signingKey.toString('hex')));
   await writeFile(keyFile,new Uint8Array(31));const invalid=await submit();assert.equal(invalid.status,503);assert.ok(!(await invalid.text()).includes(keyFile));
   delete process.env.VCP_DOWNLOAD_PREVIEW_KEY_FILE;const unsigned=await submit();assert.equal(unsigned.status,201);assert.equal((await unsigned.json()).previewToken,null);
   await db.session.delete({where:{id:hash(sessionToken)}});
  }finally{if(priorKey===undefined)delete process.env.VCP_DOWNLOAD_PREVIEW_KEY_FILE;else process.env.VCP_DOWNLOAD_PREVIEW_KEY_FILE=priorKey;await app?.close();await unlink(keyFile).catch(()=>{});signingKey.fill(0)}
  const accountKey=randomBytes(32).toString('hex'),verifiedAt=new Date(Date.now()-100).toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision:randomUUID(),keyId:'manual-download-test',expiresAt},{accessToken:'synthetic-test-token',apiKey:'synthetic-test-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt},async()=>randomBytes(32));
  for(const gate of ['G01','G07'])await persistReadiness(db,{gate,status:'PASS',probeAt:new Date().toISOString(),sourceAt:verifiedAt,expiresAt,sourceReference:'synthetic-manual-download',reason:null,details:{synthetic:true}});
  const ready=await readDownloadPreview(db,owner,request,accountKey),authorizationKey=randomBytes(32),previewToken=signDownloadPreview(ready,owner,authorizationKey),idempotencyKey=randomUUID(),submission={previewToken,mode:'MISSING_ONLY',idempotencyKey};
  const accepted=await acceptManualDownload(db,owner,submission,authorizationKey,accountKey),duplicate=await acceptManualDownload(db,owner,submission,authorizationKey,accountKey);assert.equal(accepted.runId,duplicate.runId);assert.equal(duplicate.reused,true);const detail=await readManualDownload(db,owner,accepted.runId);assert.equal(detail.status,'QUEUED');assert.equal(detail.dispatchAvailable,false);assert.ok(!JSON.stringify(detail).includes(accountKey));await assert.rejects(readManualDownload(db,randomUUID(),accepted.runId),/NOT_FOUND/);
  const concurrent=await Promise.all([1,2].map(()=>acceptManualDownload(db,owner,{...submission,idempotencyKey:randomUUID()},authorizationKey,accountKey)));assert.ok(concurrent.every(r=>r.runId===accepted.runId));
  const rows=await db.$queryRaw`SELECT count(*)::integer AS count FROM "ManualDownloadEvent" WHERE "runId"=${accepted.runId}::uuid`;assert.equal(rows[0].count,1);
  let prepared;for(let i=0;i<100;i++){const next=await prepareManualDownload(db);if(next.runId===accepted.runId){prepared=next;break}if(next.state==='IDLE')break}assert.equal(prepared?.state,'RUNNING');assert.equal(prepared.children,1);
  const children=()=>db.$queryRaw`SELECT "syncRunId" FROM "ManualDownloadChild" WHERE "manualRunId"=${accepted.runId}::uuid`;
  const child=await children();assert.equal(child.length,1);const windows=await db.$queryRaw`SELECT "state","expectedSessions" FROM "HistoricalSyncWindow" WHERE "runId"=${child[0].syncRunId}::uuid`;assert.equal(windows.length,1);assert.deepEqual(windows[0].expectedSessions,['2025-01-02']);assert.equal(windows[0].state,'PENDING');
  await prepareManualDownload(db);assert.deepEqual(await children(),child);assert.equal((await readManualDownload(db,owner,accepted.runId)).status,'RUNNING');
  const changed=await readDownloadPreview(db,owner,{...request,mode:'RECONCILE'},accountKey);await assert.rejects(acceptManualDownload(db,owner,{...submission,previewToken:signDownloadPreview(changed,owner,authorizationKey),mode:'RECONCILE'},authorizationKey,accountKey),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(db.$executeRaw`DELETE FROM "ManualDownloadEvent" WHERE "runId"=${accepted.runId}::uuid`);
  const deniedAt=new Date().toISOString();await persistSource(db,{...source,knownAt:deniedAt,uses:{...source.uses,DISPLAY:false}});await assert.rejects(readDownloadPreview(db,owner,request),/DOWNLOAD_PREVIEW_PERMISSION_DENIED/);
  assert.throws(()=>validateDownloadPreviewRequest({...request,listingIds:[listingId,listingId]}),/INVALID_DOWNLOAD_PREVIEW/);assert.throws(()=>validateDownloadPreviewRequest({...request,interval:'1h'}),/INVALID_DOWNLOAD_PREVIEW/);
 }finally{await db.$disconnect()}
});
