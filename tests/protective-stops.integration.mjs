import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {PrismaClient,appendPortfolio,readPortfolio,registerProfile,persistInstrumentSnapshot,evaluatePositionStop,readPositionStops} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {recordShadowAudit} from '../packages/database/dist/index.js';
const db=new PrismaClient(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('actual BUY freezes one initial stop; protective gap alerts deduplicate and never create fills',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 try{
  const owner=await db.owner.findFirstOrThrow(),listingId=randomUUID(),isin='INE'+String(randomInt(1000000000)).padStart(9,'0'),profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);
  const before=new Date(Date.now()-10000).toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10);
  await persistInstrumentSnapshot(db,{knownAt:new Date().toISOString(),sourceReference:'synthetic-stop-test',rows:[{companyId:randomUUID(),isin,listingId,exchange:'NSE',series:'EQ',symbol:'STOP-TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  const sourceId=hash(randomUUID()),source={id:sourceId,input:{listingId,configHash:profile.id,decidedAt:before,scaleRevision:hash([])},detector:{frozen:{primary:{state:'READY',lastLow:'95.02',asOf:before}}}};
  await db.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${sourceId},${listingId}::uuid,${new Date(date)},${profile.id},${JSON.stringify(source)}::jsonb)`;
  const actionSource={id:hash(randomUUID()),listingId,knownAt:before,verified:true,sourceReference:'synthetic-action-coverage',coverageFrom:'2020-01-01',coverageThrough:date,actions:[]};
  const adjustmentId=hash(randomUUID());await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${adjustmentId},${listingId}::uuid,${new Date(date)},${new Date(before)},'KNOWN',${JSON.stringify({source:actionSource})}::jsonb)`;
  const buy={kind:'FILL',isin,side:'BUY',quantity:10,price:'100',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'fixture'},key=randomUUID();
  await appendPortfolio(db,owner.id,key,buy);await appendPortfolio(db,owner.id,key,buy);
  let view=await readPositionStops(db,owner.id);const record=view.items.find(r=>r.isin===isin).record;assert.equal(record.stop.activeStop,'94.950000');assert.equal(record.sourceId,sourceId);assert.equal(view.stops.filter(s=>s.isin===isin).length,1);
  const quote={listingId,ltp:'90.000000',sourceAt:new Date().toISOString(),receivedAt:new Date().toISOString(),session:date,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(Date.now()+30000).toISOString()};
  let waiting;
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${owner.id}::uuid FOR UPDATE`;waiting=evaluatePositionStop(db,owner.id,isin,{...quote,validUntil:new Date(Date.now()+50).toISOString()});await new Promise(resolve=>setTimeout(resolve,100))});
  assert.equal((await waiting).state,'UNABLE_TO_EVALUATE');
  const at=new Date().toISOString(),shadow={mode:'SHADOW',at,strategyVersion:PROFILE_VERSION,modelVersion:'offline-1',promptVersion:'prompt-1',evidence:['VCP','RS','VOLUME','PIVOT','PORTFOLIO_RISK','SOURCE_QUALITY'].map(kind=>({kind,revision:'synthetic-1',at,quality:'VERIFIED'})),response:{version:'response-1',at,outcome:'VETO'}};
  assert.equal((await recordShadowAudit(db,owner.id,randomUUID(),shadow)).outcome,'VETO');
  assert.equal((await recordShadowAudit(db,owner.id,randomUUID(),{...shadow,response:null})).outcome,'UNAVAILABLE');
  await assert.rejects(recordShadowAudit(db,randomUUID(),randomUUID(),shadow));
  const results=await Promise.all([1,2,3].map(()=>evaluatePositionStop(db,owner.id,isin,quote)));assert.equal(results.filter(r=>r.created).length,1);assert.equal(results[0].signal.triggeredPrice,'90.000000');assert.equal(results[0].signal.activeStop,'94.950000');
  assert.equal((await readPortfolio(db,owner.id)).holdings[isin],10);
  const outbox=await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "eventId"=${results[0].signal.id}`;assert.equal(outbox.length,1);
  assert.equal((await evaluatePositionStop(db,owner.id,isin,{...quote,sourceAt:new Date(Date.now()-61000).toISOString()})).state,'UNABLE_TO_EVALUATE');
  await appendPortfolio(db,owner.id,randomUUID(),{...buy,side:'SELL',quantity:4,brokerReference:randomUUID(),occurredAt:new Date().toISOString()});
  assert.equal((await readPortfolio(db,owner.id)).holdings[isin],6);assert.equal((await evaluatePositionStop(db,owner.id,isin,quote)).created,false);
  const changed={...actionSource,id:hash(randomUUID()),actions:[{id:'split',listingId,kind:'SPLIT',effectiveAt:before,knownAt:before,sharesAfter:'2',sharesBefore:'1',verified:true,sourceReference:'fixture'}]};
  const revisedAt=new Date(Date.now()-500);
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","createdAt","state","evidence") VALUES (${changed.id},${listingId}::uuid,${new Date(date)},${revisedAt},${revisedAt},'KNOWN',${JSON.stringify({source:changed})}::jsonb)`;
  assert.equal((await evaluatePositionStop(db,owner.id,isin,quote)).state,'UNABLE_TO_EVALUATE');
  await appendPortfolio(db,owner.id,randomUUID(),{...buy,side:'SELL',quantity:6,brokerReference:randomUUID(),occurredAt:new Date().toISOString()});assert.equal((await evaluatePositionStop(db,owner.id,isin,quote)).state,'CLOSED');
  await assert.rejects(db.$executeRaw`DELETE FROM "InitialPositionStop" WHERE "id"=${record.id}`);await assert.rejects(db.$executeRaw`DELETE FROM "ProtectiveSignal" WHERE "id"=${results[0].signal.id}`);
  assert.equal((await readPositionStops(db,randomUUID())).items.length,0);
 }finally{await db.$disconnect()}
});



