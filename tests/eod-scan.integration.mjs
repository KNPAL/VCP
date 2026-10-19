import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,ingestCandles,persistAdjustment,persistInstrumentSnapshot,persistUniverse,persistReadiness,registerProfile,activateProfile,prepareEodScan,processEodScanItem,eodScanProgress,getScan} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {exchangeDate} from '../packages/domain/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
import {queue,createWorker} from '../apps/worker/dist/runtime.js';
import {eodScanHandler,dispatchEodScans} from '../apps/worker/dist/eod-scan.js';
process.env.REDIS_PORT??='56379';
const db=new PrismaClient();
test('EOD scan pins revisions, resumes lost queue jobs and accounts for every intended member',async()=>{
 let q,worker;
 try{
  const now=new Date(),date=exchangeDate(now.toISOString()),golden=goldenSeries();
  const offset=Date.parse(date)-Date.parse(golden.bars.at(-1).session);
  const dates=golden.bars.map(b=>new Date(Date.parse(b.session)+offset).toISOString().slice(0,10));
  const calendar=dates.map(d=>({date:d,kind:'TRADING',opensAt:d+'T00:00:00Z',closesAt:d+'T00:01:00Z',finalizedAt:d+'T00:02:00Z',knownAt:'2020-01-01T00:00:00Z',source:'synthetic-eod',verified:true}));
  // The last synthetic session ends just before the test's observation, independent of real exchange hours.
  Object.assign(calendar.at(-1),{opensAt:new Date(now.valueOf()-60000).toISOString(),closesAt:new Date(now.valueOf()-30000).toISOString(),finalizedAt:new Date(now.valueOf()-10000).toISOString()});
  async function instrument(flat){
   const listingId=randomUUID(),provider='synthetic-eod',observedAt=new Date().toISOString();
   const bars=golden.bars.map((b,i)=>({listingId,provider,session:dates[i],open:flat?'50':b.open,high:flat?'51':b.high,low:flat?'49':b.low,close:flat?'50':b.close,volume:b.volume,receivedAt:observedAt,finalizedAt:calendar[i].finalizedAt,zeroVolumeVerified:false}));
   const ingested=await ingestCandles(db,{listingId,provider,from:dates[0],to:date,asOf:observedAt,calendar,bars});assert.equal(ingested.inserted,310);
   const revisions=await db.$queryRaw`SELECT "session","revisionId" FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid`;
   const input={listingId,asOf:new Date().toISOString(),scaleSession:date,source:{id:'synthetic-no-actions',listingId,knownAt:observedAt,verified:true,sourceReference:'synthetic',coverageFrom:dates[0],coverageThrough:date,actions:[]},raw:bars.map(b=>({...b,revisionId:revisions.find(r=>r.session.toISOString().slice(0,10)===b.session).revisionId}))};
   const adjusted=await persistAdjustment(db,input);assert.equal(adjusted.state,'KNOWN');return {listingId,provider,ingested,adjusted,input};
  }
  const target=await instrument(false),benchmark=await instrument(true);
  const isin='INE'+String(Math.floor(Math.random()*1000000000)).padStart(9,'0'),missing='INE'+String(Math.floor(Math.random()*1000000000)).padStart(9,'0');
  await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-eod',rows:[{companyId:randomUUID(),listingId:target.listingId,isin,exchange:'NSE',series:'EQ',symbol:'SYNTH-EOD',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:target.provider,token:'1',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  await persistUniverse(db,{universe:'NIFTY_500',knownAt:new Date().toISOString(),effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-eod',historicalConstituentsVerified:true,isins:[isin,missing]});
  const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0),activated=new Date().toISOString();await activateProfile(db,profile.id,activated,activated);
  const proofAt=new Date().toISOString();await persistReadiness(db,{gate:'G04',status:'PASS',probeAt:proofAt,sourceAt:proofAt,expiresAt:new Date(Date.now()+3600000).toISOString(),sourceReference:'synthetic',reason:null,details:{identifier:'NIFTY_500_PRICE',adjustmentId:benchmark.adjusted.revision}});
  const request={scanId:randomUUID(),session:date,asOf:new Date().toISOString(),calendarId:target.ingested.calendarHash};
  const plan=await prepareEodScan(db,request);assert.equal(plan.items.length,2);assert.equal(plan.benchmarkAdjustmentId,benchmark.adjusted.revision);
  assert.equal(plan.items.find(i=>i.isin===isin).rs,null); // only 50% comparable: missing member remains in denominator
  assert.deepEqual(await prepareEodScan(db,request),plan);
  await assert.rejects(prepareEodScan(db,{...request,calendarId:'a'.repeat(64)}),/SCAN_REQUEST_CONFLICT/);
  await assert.rejects(prepareEodScan(db,{...request,scanId:randomUUID(),asOf:'2099-01-01T00:00:00Z'}),/SCAN_FUTURE_REQUEST/);
  // Newer negative evidence cannot replace an already pinned snapshot.
  await persistAdjustment(db,{...target.input,asOf:new Date().toISOString(),source:{...target.input.source,verified:false}});
  assert.deepEqual(await prepareEodScan(db,request),plan);
  q=queue('eod-'+randomUUID());await dispatchEodScans(db,q);
  const lost=(await q.getJobs(['waiting'])).find(j=>j.data.itemId===plan.items[0].id);assert.ok(lost);await lost.remove();
  await dispatchEodScans(db,q);assert.ok(await q.getJob(lost.id));
  await assert.rejects(eodScanHandler(db)({itemId:plan.items[0].id,price:'1'}),/INVALID_EOD_SCAN_PAYLOAD/);
  worker=createWorker(q.name,{'eod-scan':eodScanHandler(db)});
  const deadline=Date.now()+30000;while(Date.now()<deadline){if(await getScan(db,request.scanId))break;await new Promise(r=>setTimeout(r,100))}
  const result=await getScan(db,request.scanId);assert.ok(result);assert.equal(result.status,'PARTIAL');assert.equal(result.counts.intended,2);assert.equal(result.counts.analyzed,1);assert.equal(result.counts.missing,1);
  assert.ok(result.entries.some(e=>e.reasons.includes('INSTRUMENT_MAPPING_MISSING')));assert.equal(result.candidates[0].marketState,'BLOCKED_DATA');
  const progress=await eodScanProgress(db,request.scanId);assert.equal(progress.completed,2);
  const daily=await db.$queryRaw`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${target.listingId}::uuid`;
  assert.equal(daily.length,1);assert.equal(daily[0].evidence.input.adjustmentRevision,target.adjusted.revision);
  const item=plan.items.find(i=>i.isin===isin);await Promise.all([processEodScanItem(db,item.id),processEodScanItem(db,item.id)]);assert.deepEqual(await getScan(db,request.scanId),result);
  await assert.rejects(db.$executeRaw`DELETE FROM "EodScanCheckpoint" WHERE "itemId"=${item.id}`);
  const later=await prepareEodScan(db,{...request,scanId:randomUUID(),asOf:new Date().toISOString()});assert.equal(later.items.find(i=>i.isin===isin).reason,'ADJUSTMENT_UNAVAILABLE');
  for(const pending of later.items)await processEodScanItem(db,pending.id);
  assert.equal((await getScan(db,later.request.scanId)).status,'ERROR');
  // Complete comparable coverage produces a persisted RS value, not an UNKNOWN fallback.
  const peer=await instrument(true),peerIsin='INE'+String(Math.floor(Math.random()*1000000000)).padStart(9,'0');
  await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-complete-eod',rows:[{companyId:randomUUID(),listingId:peer.listingId,isin:peerIsin,exchange:'NSE',series:'EQ',symbol:'SYNTH-PEER',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:peer.provider,token:'2',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  await persistUniverse(db,{universe:'NIFTY_500',knownAt:new Date().toISOString(),effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-complete-eod',historicalConstituentsVerified:true,isins:[peerIsin]});
  const complete=await prepareEodScan(db,{...request,scanId:randomUUID(),asOf:new Date().toISOString()});assert.equal(complete.items[0].rs,'50.00000000');
  const first=await processEodScanItem(db,complete.items[0].id);assert.equal(first.scanComplete,true);
  assert.equal((await getScan(db,complete.request.scanId)).status,'COMPLETE');
  const peerDaily=await db.$queryRaw`SELECT "id" FROM "DailyStructureExecution" WHERE "listingId"=${peer.listingId}::uuid`;
  assert.equal(peerDaily.length,1);
  // Checkpoints survive deletion of all test queue jobs; completed scan needs no recompute.
  await worker.close();worker=null;await q.obliterate({force:true});await dispatchEodScans(db,q);
  assert.equal((await q.getJobs(['waiting'])).some(j=>complete.items.some(i=>i.id===j.data.itemId)),false);
 }finally{if(worker)await worker.close();if(q){await q.obliterate({force:true});await q.close()}await db.$disconnect()}
});
