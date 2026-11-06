import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {candlePermission,actionPermission} from '../fixtures/candle-permission.mjs';
import {appendPortfolio,persistInstrumentSnapshot,registerProfile} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {queue,acquireLease} from '../apps/worker/dist/runtime.js';
import {publishLiveTick,recordQuoteConnection} from '../apps/worker/dist/live-quotes.js';
import {monitorHeldPositions} from '../apps/worker/dist/position-monitor.js';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fixture=await isolatedDatabase('risk_latency',{initialCapital:'100000'}),db=fixture.db;
const stream='risk-benchmark-'+randomUUID(),q=queue(stream),listingId=randomUUID(),isin='INE000000001';
let timer,polling,error;
try{
 const owner=await db.owner.findFirstOrThrow(),provider='synthetic-latency';
 await candlePermission(db,provider,{},'LIVE_QUOTES');
 const sourceSnapshotId=await actionPermission(db),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
 const before=new Date(Date.now()-10000).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10),midnight=Date.parse(date+'T00:00:00Z')-19800000;
 const session={date,opensAt:new Date(midnight).toISOString(),closesAt:new Date(midnight+86399999).toISOString(),knownAt:before,verified:true};
 const calendar=[{...session,kind:'SPECIAL',source:'synthetic-latency',finalizedAt:new Date(midnight+86399999).toISOString()}];
 await db.$executeRaw`INSERT INTO "CalendarSnapshot" (id,evidence) VALUES (${hash(calendar)},${JSON.stringify(calendar)}::jsonb)`;
 const mapping=await persistInstrumentSnapshot(db,{knownAt:before,sourceReference:'synthetic-latency',rows:[{companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'LATENCY',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider,token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
 const sourceId=hash(randomUUID()),structure={id:sourceId,input:{listingId,configHash:profile.id,decidedAt:before,scaleRevision:hash([])},detector:{frozen:{primary:{state:'READY',lastLow:'95.02',asOf:before}}}};
 await db.$executeRaw`INSERT INTO "DailyStructureExecution" (id,"listingId",session,"configHash",evidence) VALUES (${sourceId},${listingId}::uuid,${new Date(date)},${profile.id},${JSON.stringify(structure)}::jsonb)`;
 const action={id:hash(randomUUID()),sourceSnapshotId,listingId,knownAt:before,verified:true,sourceReference:'synthetic-latency',coverageFrom:'2020-01-01',coverageThrough:date,actions:[]};
 await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" (id,"listingId","scaleSession","asOf",state,evidence) VALUES (${action.id},${listingId}::uuid,${new Date(date)},${new Date(before)},'KNOWN',${JSON.stringify({source:action})}::jsonb)`;
 const fence=await acquireLease(q,stream,600000);assert.ok(fence);
 await recordQuoteConnection(q,stream,fence,'CONNECTED');
 const cadenceMs=5000,samples=[],phases=[];let sequence=0;
 const tick=price=>publishLiveTick(q,stream,fence,{provider,token:'123',exchange:'NSE',rawLtp:price,priceDecimals:2,sourceAt:new Date().toISOString(),sequence:String(++sequence)},mapping,session);
 const fill=side=>appendPortfolio(db,owner.id,randomUUID(),{kind:'FILL',isin,side,quantity:1,price:'100',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-latency'});
 const origin=performance.now();
 timer=setInterval(()=>{
  if(polling)return;
  polling=(async()=>{await recordQuoteConnection(q,stream,fence,'CONNECTED');await monitorHeldPositions(db,q,stream)})().catch(e=>{error=e}).finally(()=>{polling=null});
 },cadenceMs);
 for(let i=0;i<20;i++){
  assert.equal((await tick('10000')).state,'KNOWN');await fill('BUY');
  await sleep((i*1379)%cadenceMs);
  if(error)throw error;
  const started=performance.now();phases.push(Math.round((started-origin)%cadenceMs));
  const published=await tick('9000');assert.equal(published.state,'KNOWN');
  let saved=false;
  while(performance.now()-started<15000){
   if(error)throw error;
   const rows=await db.$queryRaw`SELECT id FROM "ProtectiveSignal" WHERE "ownerId"=${owner.id}::uuid AND evidence->'quote'->>'sourceAt'=${published.quote.sourceAt}`;
   if(rows.length){saved=true;break}await sleep(25);
  }
  assert.ok(saved,'Fresh stop-breach tick must persist a protective risk event');
  samples.push(performance.now()-started);await polling;await fill('SELL');
  console.log(JSON.stringify({phase:'sample',count:i+1,elapsedMs:Math.round(samples.at(-1))}));
 }
 samples.sort((a,b)=>a-b);const p95=samples[Math.ceil(samples.length*0.95)-1];
 console.log(JSON.stringify({measuredAt:new Date().toISOString(),input:'synthetic healthy normalized quotes; one held position; real Redis and PostgreSQL',scope:'production monitor function at 5-second cadence; excludes broker transport and unrelated worker dispatch jobs',samples:samples.length,pollPhaseMs:phases,p95Ms:Math.round(p95),targetMs:5000,passed:p95<=5000},null,2));
 if(p95>5000)process.exitCode=1;
}finally{
 clearInterval(timer);await polling;
 const client=await q.client;
 await client.del('lease:'+stream,'fence:'+stream,'quotes:'+stream+':connection','quotes:'+stream+':'+listingId,'quotes:'+stream+':'+listingId+':watermark');
 await q.close();await fixture.close();
}
