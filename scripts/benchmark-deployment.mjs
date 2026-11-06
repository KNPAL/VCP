import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
import {actionPermission,benchmarkReview,candlePermission} from '../fixtures/candle-permission.mjs';
import {registerProfile,activateProfile,persistInstrumentSnapshot,persistUniverse,persistReadiness,prepareEodScan,processEodScanItem,getScan} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {createApp} from '../apps/api/dist/app.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fixture=await isolatedDatabase('performance'),db=fixture.db;
let app;
try{
 const owner=await db.owner.findFirstOrThrow(),seed=goldenSeries(),today=new Date(Date.now()+19800000).toISOString().slice(0,10);
 const dates=seed.bars.map((_,i)=>new Date(Date.parse(today+'T00:00:00Z')-(seed.bars.length-1-i)*86400000).toISOString().slice(0,10));
 const observed=new Date(Date.now()-10000).toISOString();
 const calendar=dates.map(date=>({date,kind:'SPECIAL',opensAt:date+'T00:00:00Z',closesAt:date+'T00:01:00Z',finalizedAt:date+'T00:02:00Z',knownAt:'2020-01-01T00:00:00Z',source:'synthetic-benchmark-calendar',verified:true}));
 Object.assign(calendar.at(-1),{opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()-30000).toISOString(),finalizedAt:observed});
 const calendarId=hash(calendar);
 await db.$executeRaw`INSERT INTO "CalendarSnapshot" (id,evidence) VALUES (${calendarId},${JSON.stringify(calendar)}::jsonb)`;
 const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
 const activeAt=profile.createdAt.toISOString();await activateProfile(db,profile.id,activeAt,activeAt);
 const provider='synthetic-performance',grant=await candlePermission(db,provider),actionId=await actionPermission(db),mappings=[],adjustments=[];
 for(let n=0;n<=500;n++){
  const listingId=randomUUID(),isin='INE'+String(n+1).padStart(9,'0');
  const bars=seed.bars.map((bar,i)=>({...bar,session:dates[i],rawRevisionId:randomUUID(),endedAt:calendar[i].closesAt,finalizedAt:calendar[i].finalizedAt,volume:String(Number(bar.volume)*50000+n)}));
  await db.candleRevision.createMany({data:bars.map(b=>({id:b.rawRevisionId,listingId,session:new Date(b.session),scale:'RAW',revision:1,open:b.open,high:b.high,low:b.low,close:b.close,volume:BigInt(b.volume),source:provider,receivedAt:new Date(observed),finalizedAt:new Date(b.finalizedAt)}))});
  const source={sourceSnapshotId:actionId,id:hash(listingId),listingId,knownAt:observed,verified:true,sourceReference:'synthetic-reviewed-actions',coverageFrom:dates[0],coverageThrough:today,actions:[]};
  const id=hash([listingId,bars]);
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" (id,"listingId","scaleSession","asOf",state,evidence) VALUES (${id},${listingId}::uuid,${new Date(today)},${new Date(observed)},'KNOWN',${JSON.stringify({source,result:{bars}})}::jsonb)`;
  adjustments.push({id,listingId,bars});
  if(n<500)mappings.push({listingId,companyId:randomUUID(),isin,exchange:'NSE',series:'EQ',symbol:'SYNTH'+n,instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider,token:String(n+1),validFrom:'2020-01-01',validTo:null,verified:true,enabled:true});
  if((n+1)%100===0)console.log(JSON.stringify({phase:'fixture',listings:n+1}));
 }
 await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-performance',rows:mappings});
 await persistUniverse(db,{universe:'NIFTY_500',knownAt:new Date().toISOString(),effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-performance',historicalConstituentsVerified:true,isins:mappings.map(m=>m.isin)});
 const benchmark=adjustments.at(-1),identityReview=await benchmarkReview(db,benchmark.listingId,benchmark.bars),probeAt=new Date().toISOString();
 await persistReadiness(db,{gate:'G04',status:'PASS',probeAt,sourceAt:probeAt,expiresAt:grant.validUntil,sourceReference:'synthetic-independent-index-review',reason:null,details:{identifier:'NIFTY_500_PRICE',adjustmentId:benchmark.id,calendarId,identityReview}});
 const started=performance.now(),scanId=randomUUID();
 const plan=await prepareEodScan(db,{scanId,session:today,calendarId,asOf:new Date().toISOString()});assert.equal(plan.items.length,500);
 console.log(JSON.stringify({phase:'prepared',elapsedMs:Math.round(performance.now()-started)}));
 for(let i=0;i<plan.items.length;i++){
  await processEodScanItem(db,plan.items[i].id);
  if((i+1)%50===0)console.log(JSON.stringify({phase:'processed',count:i+1,elapsedMs:Math.round(performance.now()-started)}));
 }
 const scan=await getScan(db,scanId);assert.equal(scan?.status,'COMPLETE');assert.equal(scan.counts.analyzed,500);const elapsedMs=performance.now()-started;
 const token=randomBytes(32).toString('hex'),csrf=hash(token);
 await db.session.create({data:{id:createHash('sha256').update(token).digest('hex'),ownerId:owner.id,csrfHash:csrf,expiresAt:new Date(Date.now()+600000)}});
 app=await createApp({db,secure:false,origin:'http://localhost',logSink:()=>{}});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),samples=[];
 for(let n=0;n<21;n++){
  const start=performance.now(),response=await fetch(base+'/api/v1/vcp/candidates?scanId='+scanId+'&limit=50',{headers:{cookie:'vcp_session='+token}});
  assert.equal(response.status,200);const page=await response.json();assert.equal(page.items.length,50);
  if(n)samples.push(performance.now()-start);
 }
 samples.sort((a,b)=>a-b);const p95=samples[Math.ceil(samples.length*0.95)-1];
 console.log(JSON.stringify({measuredAt:new Date().toISOString(),input:'synthetic finalized data in disposable PostgreSQL schema',stocks:500,eodMs:Math.round(elapsedMs),eodTargetMs:1800000,apiP95Ms:Math.round(p95),apiTargetMs:2000,passed:elapsedMs<=1800000&&p95<=2000},null,2));
 if(elapsedMs>1800000||p95>2000)process.exitCode=1;
}finally{await app?.close();await fixture.close()}
