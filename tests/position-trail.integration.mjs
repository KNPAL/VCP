import test from 'node:test';
import {candlePermission} from '../fixtures/candle-permission.mjs';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {PrismaClient,ingestCandles,persistAdjustment,persistInstrumentSnapshot,registerProfile,appendPortfolio,readPortfolio,readPositionStops,evaluatePositionTrail,evaluatePositionStop,effectivePositionStop} from '../packages/database/dist/index.js';
import {protectiveDecision} from '../packages/portfolio/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {exchangeDate} from '../packages/domain/dist/index.js';
const db=new PrismaClient(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('EOD trails are immutable, effective next session and do not execute fills',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  await candlePermission(db,'fixture-trail');
  const owner=await db.owner.findFirstOrThrow(),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
  for(const {sell,fail,protect} of [{sell:false,fail:false},{sell:true,fail:false},{sell:false,fail:true},{sell:true,fail:false,protect:true}]){
   await new Promise(resolve=>setTimeout(resolve,4000));
   const now=Date.now(),date=exchangeDate(new Date(now).toISOString()),listingId=randomUUID(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0');
   const dates=Array.from({length:50},(_,i)=>new Date(Date.parse(date)-(49-i)*86400000).toISOString().slice(0,10));
   const boughtAt=fail?dates[47]+'T'+new Date(now).toISOString().slice(11):new Date(now-3000).toISOString();
   const before=new Date(Date.parse(boughtAt)-1).toISOString();
   const tomorrow=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
   const calendar=[...dates,tomorrow].map(d=>({date:d,kind:'TRADING',opensAt:d+'T00:00:00.000Z',closesAt:d+'T00:01:00.000Z',finalizedAt:d===tomorrow?null:d+'T00:02:00.000Z',knownAt:before,source:'synthetic-trail',verified:true}));
   Object.assign(calendar[49],{opensAt:new Date(now-8000).toISOString(),closesAt:new Date(now-2000).toISOString(),finalizedAt:new Date(now-1000).toISOString()});
   const sourceId=hash(randomUUID()),structure={id:sourceId,input:{listingId,configHash:profile.id,decidedAt:before,scaleRevision:hash([])},detector:{frozen:{primary:{state:'READY',pivot:'111',lastLow:sell?'80.05':'95.00',asOf:before}}}};
   const mapping={knownAt:before,sourceReference:'synthetic-trail',rows:[{companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'TRAIL',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture-trail',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]};await persistInstrumentSnapshot(db,mapping);
   await db.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${sourceId},${listingId}::uuid,${new Date(date)},${profile.id},${JSON.stringify(structure)}::jsonb)`;
   const observedAt=new Date().toISOString(),bars=dates.map((d,i)=>({listingId,provider:'fixture-trail',session:d,open:'110',high:'112',low:sell&&i===49?'99':'108',close:sell&&i===49?'100':'110',volume:'1000000',receivedAt:observedAt,finalizedAt:calendar[i].finalizedAt,zeroVolumeVerified:false}));
   await ingestCandles(db,{listingId,provider:'fixture-trail',from:dates[0],to:date,asOf:observedAt,calendar,bars});
   const revisions=await db.$queryRaw`SELECT "session","revisionId" FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid`;
   await persistAdjustment(db,{listingId,asOf:new Date().toISOString(),scaleSession:date,source:{id:hash(randomUUID()),listingId,knownAt:before,verified:true,sourceReference:'synthetic-trail',coverageFrom:dates[0],coverageThrough:tomorrow,actions:[]},raw:bars.map(b=>({...b,revisionId:revisions.find(r=>r.session.toISOString().slice(0,10)===b.session).revisionId}))});
   await appendPortfolio(db,owner.id,randomUUID(),{kind:'FILL',isin,side:'BUY',quantity:10,price:sell?'90':'100',fees:'0',brokerReference:randomUUID(),occurredAt:boughtAt,sourceId:'synthetic-trail'});
   const initial=(await readPositionStops(db,owner.id)).items.find(p=>p.isin===isin).record;
   await persistInstrumentSnapshot(db,{...mapping,knownAt:new Date().toISOString(),sourceReference:'synthetic-trail-current'});
   const beforeEvents=(await readPortfolio(db,owner.id)).events;
   if(protect){const at=new Date().toISOString();assert.equal((await evaluatePositionStop(db,owner.id,isin,{listingId,ltp:'70',sourceAt:at,receivedAt:at,session:date,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(Date.now()+30000).toISOString()})).state,'SELL_PROTECTIVE')}
   const results=await Promise.all([1,2,3].map(()=>evaluatePositionTrail(db,owner.id,isin)));
   assert.equal(results.filter(r=>r.created).length,1,JSON.stringify(results));
   const result=results.find(r=>r.created).evidence;
   assert.equal(result.result.state,sell?'SELL_EMA_CLOSE':'TRAIL_UPDATE');
   assert.equal(result.result.nextStop,sell?'80.000000':'108.000000');
   assert.equal(result.result.effectiveAt,calendar[50].opensAt);
   assert.equal((await readPositionStops(db,owner.id)).items.find(p=>p.isin===isin).record.stop.activeStop,initial.stop.activeStop);
   const active=await effectivePositionStop(db,initial,calendar[50].opensAt);assert.equal(active.activeStop,result.result.nextStop);
   if(!sell){
    const at=new Date().toISOString(),quote={listingId,ltp:'100',sourceAt:at,receivedAt:at,session:date,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(Date.now()+30000).toISOString()};
    assert.equal((await evaluatePositionStop(db,owner.id,isin,quote)).state,'NOT_BREACHED');
    const gap={...quote,sourceAt:calendar[50].opensAt,receivedAt:calendar[50].opensAt,session:tomorrow,validUntil:new Date(Date.parse(calendar[50].opensAt)+30000).toISOString()};
    assert.equal(protectiveDecision(active,gap,hash([]),10,gap.sourceAt).state,'SELL_PROTECTIVE');
   }else{const outbox=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${result.id}`;assert.equal(outbox.length,protect?0:1)}
   const failures=(await readPositionStops(db,owner.id)).failures.filter(f=>f.isin===isin&&f.result.state==='SELL_BREAKOUT_FAILURE');
   assert.equal(failures.length,fail?1:0);
   if(fail){assert.equal(failures[0].result.triggerSession,date);assert.equal(failures[0].result.effectiveAt,calendar[50].opensAt);const outbox=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${failures[0].id}`;assert.equal(outbox.length,1);await assert.rejects(db.$executeRaw`DELETE FROM "PositionFailure" WHERE "id"=${failures[0].id}`)}
   assert.deepEqual((await readPortfolio(db,owner.id)).events,beforeEvents);
   await assert.rejects(db.$executeRaw`DELETE FROM "PositionTrail" WHERE "id"=${result.id}`);
  }
 }finally{await db.$disconnect()}
});




