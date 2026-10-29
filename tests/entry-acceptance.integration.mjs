import {signalLineage} from '../fixtures/signal-lineage.mjs';
import {licensedSources} from '../fixtures/licensed-sources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PrismaClient,recordPositionStatus,persistSource,assertPlanQuoteDisplay,assertCandlePermissions,registerProfile,activateProfile,persistInstrumentSnapshot,persistUniverse,persistSectors,pinScanUniverse,persistReadiness,persistSurveillance,persistMarketEvent,appendPortfolio,readPortfolio,recordReconciliation,recordPortfolioRisk,recordEntryRisk,readEntryRisk,saveBrokerConfiguration,installBrokerSession,ownerStreamBinding,readCurrentRegime} from '../packages/database/dist/index.js';
import {marketRegime} from '../packages/indicators/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
import {brokerAccountKey} from '../packages/market-data/dist/index.js';
import {createApp} from '../apps/api/dist/app.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('positive entry persists exact quantity, invalidates changed live evidence and records only actual manual fills',async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.pathname,'/vcp_test');
 const schema='entry_acceptance_'+randomUUID().replaceAll('-','');assert.match(schema,/^entry_acceptance_[a-f0-9]{32}$/);
 const admin=new PrismaClient();let db,app;
 try{
  await admin.$executeRawUnsafe('CREATE SCHEMA "'+schema+'"');url.searchParams.set('schema',schema);
  const migration=spawnSync(process.execPath,['packages/database/node_modules/prisma/build/index.js','migrate','deploy','--schema','packages/database/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8',timeout:120000});assert.equal(migration.status,0,'Temporary-schema migrations must succeed');
  db=new PrismaClient({datasources:{db:{url:url.toString()}}});assert.equal((await db.$queryRaw`SELECT current_schema() AS name`)[0].name,schema);
  const owner=await db.owner.create({data:{login:'synthetic-entry-owner',passwordHash:'not-used-for-authentication'}}),key=randomBytes(32),listingId=randomUUID(),isin='INE000000001';
  const date=new Date(Date.now()+19800000).toISOString().slice(0,10),day=offset=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10),knownAt=new Date(Date.now()-10000).toISOString(),expiresAt=new Date(Date.now()+300000).toISOString();
  const profile=await registerProfile(db,PROFILE_VERSION,ST_VCP_4_0);await new Promise(resolve=>setTimeout(resolve,25));const activatedAt=new Date(Math.max(Date.now(),profile.createdAt.valueOf())).toISOString();await activateProfile(db,profile.id,activatedAt,activatedAt);
  const mapping=await persistInstrumentSnapshot(db,{knownAt,sourceReference:'synthetic-positive-entry',rows:[{companyId:randomUUID(),listingId,isin,exchange:'NSE',series:'EQ',symbol:'ENTRY',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]});
  const calendar=[-1,0,1].map(offset=>({date:day(offset),kind:'SPECIAL',opensAt:new Date(day(offset)+'T00:00:00+05:30').toISOString(),closesAt:new Date(day(offset)+'T23:59:59+05:30').toISOString(),finalizedAt:offset<0?new Date(day(offset)+'T23:59:59+05:30').toISOString():null,knownAt,source:'synthetic-all-day-calendar',verified:true})),calendarId=hash(calendar);
  await db.$executeRaw`INSERT INTO "CalendarSnapshot" ("id","evidence") VALUES (${calendarId},${JSON.stringify(calendar)}::jsonb)`;
  await persistSectors(db,[{isin,sector:'TECH',validFrom:'2020-01-01',validTo:null,knownAt,sourceReference:'synthetic-sector'}],knownAt);
  await persistUniverse(db,{universe:'NIFTY_500',knownAt,effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic-universe',historicalConstituentsVerified:true,isins:[isin]});
  const adjustmentId=hash(randomUUID()),actionSource={id:adjustmentId,listingId,knownAt,verified:true,sourceReference:'synthetic-actions',coverageFrom:'2020-01-01',coverageThrough:day(1),actions:[]};
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${adjustmentId},${listingId}::uuid,${new Date(day(-1))},${new Date(knownAt)},'KNOWN',${JSON.stringify({source:actionSource})}::jsonb)`;
  for(const gate of ['G01','G02','G03','G04','G05','G07','G08','G09','G10'])await persistReadiness(db,{gate,status:'PASS',probeAt:new Date().toISOString(),sourceAt:knownAt,expiresAt,sourceReference:'synthetic-acceptance',reason:null,details:gate==='G07'?await licensedSources(db,knownAt,expiresAt):gate==='G04'?{identifier:'NIFTY_500_PRICE',adjustmentId}:{synthetic:true}});
  const scanId=randomUUID(),scanAt=new Date().toISOString(),universe=await pinScanUniverse(db,scanId,scanAt),members=[{isin,adjustmentId,close:'101',sma50:'90'}],regime={session:day(-1),asOf:scanAt,calendarId,benchmark:{adjustmentId,proofId:null,close:'110',sma50:'100',sma200:'90'},members,intended:[isin],result:marketRegime('110','100','90',[isin],members)};
  const scan={request:{scanId,session:day(-1),asOf:scanAt,calendarId},configHash:profile.id,dataRevision:hash(regime),universe,regime,items:[],benchmarkAdjustmentId:adjustmentId,benchmarkProofId:null};
  await db.$executeRaw`INSERT INTO "EodScanPlan" ("id","evidence") VALUES (${scanId}::uuid,${JSON.stringify(scan)}::jsonb)`;
  await new Promise(resolve=>setTimeout(resolve,25));const initialRegime=await db.$transaction(tx=>readCurrentRegime(tx,new Date().toISOString()));assert.equal(initialRegime.regime,'GREEN',JSON.stringify(initialRegime.reasons));
  const source={dataset:'surveillance',provider:'synthetic',endpointOrFile:'fixture',licenseRef:'synthetic-only',uses:{STORE:true,DERIVE:true,DISPLAY:true,DOWNLOAD:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:knownAt,knownAt,effectiveAt:knownAt,validUntil:expiresAt,lastVerified:knownAt,maximumAgeMs:300000,adjustmentPolicy:'raw',coverage:{intended:1,available:1},error:null};
  const liveSource=await persistSource(db,{...source,dataset:'LIVE_QUOTES',provider:'fixture',endpointOrFile:'synthetic-live'});
  await persistSurveillance(db,{listingId,mappingRevision:mapping.id,source,restrictions:{verified:true,knownAt,sourceAt:knownAt,validUntil:expiresAt,asm:false,gsm:false,esm:false,cashTradable:true,lowerBand:'90',upperBand:'110'}});
  const eventId=hash(randomUUID()),event={id:eventId,logicalId:eventId,listingId,type:'BREAKOUT_CONFIRMED',patternId:eventId,session:day(-1),pivot:'100',lastLow:'94',close:'101',rvol:{numerator:'150',denominator:'100'},reasons:[],occurredAt:calendar[0].closesAt,observedAt:calendar[0].closesAt,decidedAt:knownAt,effectiveAt:knownAt,strategyVersion:'ST_VCP_4_0',configHash:profile.id,dataRevision:eventId,sourceRevisions:[eventId],previousSnapshot:{listingId,patternId:eventId,session:day(-2),state:'READY',pivot:'100',lastLow:'94',asOf:calendar[0].opensAt,configHash:profile.id,dataRevision:eventId}};
  const signalSource=await signalLineage(db,event);await persistMarketEvent(db,event);
  await appendPortfolio(db,owner.id,randomUUID(),{kind:'INITIAL_CAPITAL',amount:'100000',verified:true,occurredAt:knownAt,sourceId:'synthetic-capital'});
  await recordReconciliation(db,owner.id,randomUUID(),{asOf:new Date().toISOString(),sourceReference:'synthetic-statement',cash:'100000',holdings:[],fillReferences:[],allOutsideActivityIncluded:true});
  const clientCode='T'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),accountKey=brokerAccountKey(clientCode),sessionRevision=randomUUID();
  await saveBrokerConfiguration(db,owner.id,{apiKey:'synthetic-api',clientCode},randomUUID(),key);await new Promise(resolve=>setTimeout(resolve,5));
  await installBrokerSession(db,{reference:randomUUID(),accountKey,sessionRevision,keyId:'fixture',expiresAt},{apiKey:'synthetic-api',accessToken:'synthetic-token',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'},{authenticated:true,staticIpVerified:true,verifiedAt:new Date().toISOString()},async()=>key);
  const binding=await ownerStreamBinding(db,owner.id);assert.ok(binding.name,'Broker binding must resolve');assert.equal(binding.sessionRevision,sessionRevision);const quoteAt=new Date().toISOString(),quote={listingId,provider:'fixture',token:'123',mappingRevision:mapping.id,rawLtp:'10100',priceDecimals:2,ltp:'101.000000',sourceAt:quoteAt,receivedAt:quoteAt,decidedAt:quoteAt,session:date,sequence:'1',quality:'FRESH',connection:'CONNECTED',executable:false,validUntil:new Date(Date.now()+30000).toISOString()};
  let observation={quote,heartbeatAt:quoteAt,validUntil:quote.validUntil,bindingRevision:hash([binding.revision,binding.sessionRevision]),settled:true};
  const reader=async()=>observation,risk=await recordPortfolioRisk(db,owner.id,{}),request={marketEventId:event.id,snapshotId:risk.id,estimatedFees:'0'},idempotencyKey=randomUUID();
  const plan=await recordEntryRisk(db,owner.id,idempotencyKey,request,reader);assert.equal(plan.state,'BUY_ELIGIBLE',JSON.stringify(plan.reasons));assert.equal(plan.quantity,56);assert.equal(plan.executable,false);assert.deepEqual((await readPortfolio(db,owner.id)).holdings,{});
  const current=async()=>(await readEntryRisk(db,owner.id,reader)).items.find(item=>item.evidence.id===plan.id);
  assert.equal((await current()).current,true);
  observation={...observation,quote:{...quote,ltp:'102.000000',rawLtp:'10200',sequence:'2'}};assert.ok((await current()).validityReasons.includes('QUOTE_CHANGED_SINCE_PLAN'));
  const saved=observation;observation=null;assert.ok((await current()).validityReasons.includes('LIVE_ENTRY_EVIDENCE_CHANGED_OR_UNAVAILABLE'));observation=saved;
  assert.deepEqual(await recordEntryRisk(db,owner.id,idempotencyKey,request,reader),plan,'Retries preserve original audit evidence instead of silently revalidating');
  const token=randomBytes(32).toString('hex'),digest=value=>createHash('sha256').update(value).digest('hex'),csrf=digest('csrf:'+token),origin='http://127.0.0.1:3199';
  await db.session.create({data:{id:digest(token),ownerId:owner.id,csrfHash:digest(csrf),expiresAt:new Date(Date.now()+60000)}});
  app=await createApp({db,origin,secure:false,logSink:()=>{}});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin,'content-type':'application/json',cookie:'vcp_session='+token,'x-csrf-token':csrf,'idempotency-key':randomUUID()};
  assert.equal((await fetch(base+'/api/v1/signals?type=BUY')).status,401);
  for(const query of ['', '?type=BAD','?type=BUY&surprise=1','?type=BUY&type=SELL'])assert.equal((await fetch(base+'/api/v1/signals'+query,{headers})).status,400);
  const buys=await (await fetch(base+'/api/v1/signals?type=BUY',{headers})).json();assert.equal(buys.items[0].id,event.id);assert.equal(buys.executable,false);assert.equal(buys.items[0].plan.current,false);assert.equal(buys.items[0].plan.quoteAt,quoteAt);assert.equal(buys.items[0].plan.expiryAt,plan.expiresAt);
  for(const type of ['SELL','PRICE_ONLY']){const response=await fetch(base+'/api/v1/signals?type='+type,{headers});assert.equal(response.status,200);assert.deepEqual((await response.json()).items,[])}
  const endpoint=base+'/api/v1/signals/'+event.id+'/evaluate-plan',body=JSON.stringify({snapshotId:risk.id,estimatedFees:'0'}),post=(data=body,h=headers)=>fetch(endpoint,{method:'POST',headers:h,body:data});
  assert.equal((await post(body,{...headers,'x-csrf-token':'wrong'})).status,403);
  assert.equal((await post(JSON.stringify({...request,quote:{price:'1'}}))).status,400);
  assert.equal((await post(JSON.stringify({snapshotId:risk.id,estimatedFees:0}))).status,400);
  const response=await post();assert.equal(response.status,201);const apiPlan=await response.json();assert.equal(apiPlan.state,'BUY_BLOCKED');assert.equal(apiPlan.proposedQuantity,0);assert.equal(apiPlan.quoteAt,null);assert.equal(apiPlan.configHash,profile.id);assert.equal(apiPlan.flags.executable,false);assert.ok(Date.parse(apiPlan.expiryAt)<=Date.parse(apiPlan.evidence.asOf)+30000);
  assert.deepEqual(await (await post()).json(),apiPlan);
  for(const path of ['/portfolio','/portfolio/risk']){
   const response=await fetch(base+'/api/v1'+path,{headers});assert.equal(response.status,200);const value=await response.json(),view=path==='/portfolio'?value.risk:value;
   assert.equal(view.valuation.equity,'100000.000000');assert.equal(view.valuation.positionCount,0);assert.equal(view.reconciliation.state,'RECONCILED_AS_OF');assert.equal(view.entryPlans.executable,false);
   const saved=view.entryPlans.items.find(item=>item.id===plan.id);assert.equal(saved.riskBudget,'400.000000');assert.deepEqual(saved.caps,plan.caps);assert.equal(saved.current,false);assert.equal(saved.quoteAt,quoteAt);assert.equal(saved.expiryAt,plan.expiresAt);
  }
  assert.equal((await post(JSON.stringify({snapshotId:risk.id,estimatedFees:'1'}))).status,409);
  assert.equal((await post(JSON.stringify({snapshotId:'f'.repeat(64),estimatedFees:'0'}),{...headers,'idempotency-key':randomUUID()})).status,409);
  assert.equal((await fetch(base+'/api/v1/signals/'+'f'.repeat(64)+'/evaluate-plan',{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body})).status,422);
  assert.deepEqual((await readPortfolio(db,owner.id)).holdings,{});
  const {id:liveSourceId,...liveMetadata}=liveSource;assert.ok(liveSourceId);
  await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString(),uses:{...liveMetadata.uses,DISPLAY:false}});
  const hiddenQuotes=await (await fetch(base+'/api/v1/portfolio/risk/plans',{headers})).json();assert.equal(hiddenQuotes.items.some(item=>item.evidence.id===plan.id),false);assert.ok(hiddenQuotes.unavailable.some(item=>item.id===plan.id));
  assert.equal((await fetch(base+'/api/v1/portfolio/risk',{headers})).status,200,'Cash-only valuation does not require unrelated live prices');
  const deniedRetry=await post(body,{...headers,'idempotency-key':idempotencyKey});assert.equal(deniedRetry.status,403);assert.equal((await deniedRetry.json()).error.code,'FORBIDDEN');
  await new Promise(resolve=>setTimeout(resolve,25));await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString()});
  const fill={kind:'FILL',isin,side:'BUY',quantity:1,price:'102',fees:'0',brokerReference:randomUUID(),occurredAt:new Date().toISOString(),sourceId:'synthetic-actual-execution'};await appendPortfolio(db,owner.id,randomUUID(),fill);assert.equal((await readPortfolio(db,owner.id)).holdings[isin],1);assert.equal((await current()).current,false);
  const {id:sourceId,...sourceMetadata}=signalSource.grant;assert.ok(sourceId);
  await persistSource(db,{...sourceMetadata,knownAt:new Date().toISOString(),uses:{...sourceMetadata.uses,DISPLAY:false}});
  await assertCandlePermissions(db,event.sourceRevisions,['DISPLAY','DERIVE']);
  for(const path of ['/api/v1/signals?type=BUY','/api/v1/portfolio/signals']){
   const response=await fetch(base+path,{headers});assert.equal(response.status,200);const view=await response.json();assert.deepEqual(view.items,[]);assert.equal(view.state,'BLOCKED_DATA');assert.deepEqual(view.unavailable,[{id:event.id,reason:'SOURCE_PERMISSION_REQUIRED'}]);assert.equal(JSON.stringify(view).includes('previousSnapshot'),false);
  }
  for(const path of ['/api/v1/portfolio/risk/plans','/api/v1/portfolio/risk','/api/v1/portfolio']){
   const response=await fetch(base+path,{headers});assert.equal(response.status,200);const body=await response.json(),plans=path.endsWith('/plans')?body:path.endsWith('/risk')?body.entryPlans:body.risk.entryPlans;
   assert.deepEqual(plans.items,[]);assert.equal(plans.state,'BLOCKED_DATA');assert.ok(plans.unavailable.some(item=>item.id===plan.id&&item.reason==='SOURCE_PERMISSION_REQUIRED'));
  }
  const planCount=await db.$queryRaw`SELECT count(*)::int AS count FROM "EntryRiskPlan"`;
  for(const route of [endpoint,base+'/api/v1/portfolio/risk/plans']){
   const response=await fetch(route,{method:'POST',headers,body:route===endpoint?body:JSON.stringify({...JSON.parse(body),marketEventId:event.id})});assert.equal(response.status,403);const denied=await response.json();assert.equal(denied.error.code,'FORBIDDEN');assert.equal(Object.hasOwn(denied,'evidence'),false);
  }
  assert.deepEqual(await db.$queryRaw`SELECT count(*)::int AS count FROM "EntryRiskPlan"`,planCount);
  assert.ok((await readEntryRisk(db,owner.id,reader)).items.some(item=>item.evidence.id===plan.id),'Immutable audit history remains stored');
  for(const path of ['/api/v1/positions/cards','/api/v1/positions/'+isin+'/detail']){const response=await fetch(base+path,{headers});assert.equal(response.status,200);const value=await response.json();assert.equal(value.riskSnapshotId,risk.id)}
  const quotedValuation=await recordPortfolioRisk(db,owner.id,{[isin]:quote});
  await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString(),uses:{...liveMetadata.uses,DISPLAY:false}});
  await assert.rejects(assertPlanQuoteDisplay(db,{entry:null,valuation:{},snapshotId:quotedValuation.id}),/SOURCE_PERMISSION_REQUIRED/);
  for(const path of ['/api/v1/portfolio/risk','/api/v1/portfolio','/api/v1/portfolio/dashboard','/api/v1/positions/cards','/api/v1/positions/'+isin+'/detail']){const response=await fetch(base+path,{headers});assert.equal(response.status,403);const value=await response.json();assert.equal(value.error.code,'FORBIDDEN');assert.equal(Object.hasOwn(value,'valuation'),false);assert.equal(Object.hasOwn(value,'risk'),false)}
  const correctedAt=new Date().toISOString(),correction={...event,id:hash(randomUUID()),dataRevision:hash(randomUUID()),type:'BREAKOUT_PRICE_ONLY',decidedAt:correctedAt,effectiveAt:correctedAt};await persistMarketEvent(db,correction);
  const corrected=await (await fetch(base+'/api/v1/signals?type=PRICE_ONLY',{headers})).json();assert.deepEqual(corrected.items,[]);assert.deepEqual(corrected.unavailable,[{id:correction.id,reason:'SOURCE_LINEAGE_MISSING'}]);
  const priorBuy=await (await fetch(base+'/api/v1/signals?type=BUY',{headers})).json();assert.deepEqual(priorBuy.items,[]);assert.deepEqual(priorBuy.unavailable,[]);
  await persistSource(db,{...sourceMetadata,knownAt:new Date().toISOString()});await recordPortfolioRisk(db,owner.id,{});
  const stopId=hash(randomUUID()),episodeId=randomUUID(),stopEvidence={id:stopId,isin,episodeId,fillId:randomUUID(),quantityAtCreation:1,state:'KNOWN',reason:null,sourceId:signalSource.executionIds[0],configHash:profile.id,recordedAt:new Date().toISOString(),stop:{listingId,activeStop:'94',scaleRevision:hash([]),effectiveAt:new Date().toISOString()}};
  await db.$executeRaw`INSERT INTO "InitialPositionStop" ("id","ownerId","isin","episodeId","evidence") VALUES (${stopId},${owner.id}::uuid,${isin},${episodeId}::uuid,${JSON.stringify(stopEvidence)}::jsonb)`;
  const trailSource=hash(randomUUID()),trailId=hash(randomUUID());
  await db.$executeRaw`INSERT INTO "AdjustmentSnapshot" ("id","listingId","scaleSession","asOf","state","evidence") VALUES (${trailSource},${listingId}::uuid,${new Date(day(-1))},${new Date()},'KNOWN',${JSON.stringify({result:{bars:[{rawRevisionId:signalSource.rows[1].revision}]},source:actionSource})}::jsonb)`;
  await db.$executeRaw`INSERT INTO "PositionTrail" ("id","ownerId","stopId","session","decidedAt","state","evidence") VALUES (${trailId},${owner.id}::uuid,${stopId},${new Date(day(-1))},${new Date()},'TRAIL_UPDATE',${JSON.stringify({id:trailId,input:{sourceRevision:trailSource},result:{nextStop:'95'}})}::jsonb)`;
  const stopRoutes=['/api/v1/positions/stops','/api/v1/positions/cards','/api/v1/positions/'+isin+'/detail','/api/v1/positions/'+isin+'/timeline'];
  for(const route of stopRoutes)assert.equal((await fetch(base+route,{headers})).status,200,route);
  const {id:trailGrantId,...trailGrant}=signalSource.currentGrant;assert.ok(trailGrantId);
  await persistSource(db,{...trailGrant,knownAt:new Date().toISOString(),uses:{...trailGrant.uses,DISPLAY:false}});
  for(const route of stopRoutes)assert.equal((await fetch(base+route,{headers})).status,403,route);
  await persistSource(db,{...trailGrant,knownAt:new Date().toISOString()});
  await persistSource(db,{...sourceMetadata,knownAt:new Date().toISOString(),uses:{...sourceMetadata.uses,DISPLAY:false}});
  for(const route of stopRoutes){const response=await fetch(base+route,{headers});assert.equal(response.status,403,route);const value=await response.json();assert.equal(value.error.code,'FORBIDDEN');assert.equal(Object.hasOwn(value,'items'),false);assert.equal(Object.hasOwn(value,'stops'),false)}
  assert.equal((await readPortfolio(db,owner.id)).holdings[isin],1);
  await persistSource(db,{...sourceMetadata,knownAt:new Date().toISOString()});await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString()});
  const protectionId=hash(randomUUID());await db.$executeRaw`INSERT INTO "ProtectiveSignal" ("id","ownerId","stopId","session","recognizedAt","evidence") VALUES (${protectionId},${owner.id}::uuid,${stopId},${new Date(day(-1))},${new Date()},${JSON.stringify({id:protectionId,isin,quote,triggeredPrice:'90',scaleRevision:hash([])})}::jsonb)`;
  const status=await recordPositionStatus(db,owner.id,isin,quote);assert.equal(status.sources.quoteProvider,'fixture');
  const alertRoutes=[...stopRoutes,'/api/v1/positions/status','/api/v1/positions/sell-alerts','/api/v1/signals?type=SELL'];
  for(const route of alertRoutes)assert.equal((await fetch(base+route,{headers})).status,200,route);
  await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString(),uses:{...liveMetadata.uses,DISPLAY:false}});
  for(const route of alertRoutes){const response=await fetch(base+route,{headers});assert.equal(response.status,403,route);assert.equal((await response.json()).error.code,'FORBIDDEN')}
  await persistSource(db,{...liveMetadata,knownAt:new Date().toISOString()});
  const legacyId=hash(randomUUID());await db.$executeRaw`INSERT INTO "ProtectiveSignal" ("id","ownerId","stopId","session","recognizedAt","evidence") VALUES (${legacyId},${owner.id}::uuid,${stopId},${new Date(day(-2))},${new Date()},${JSON.stringify({id:legacyId,isin,triggeredPrice:'89',scaleRevision:hash([])})}::jsonb)`;
  for(const route of alertRoutes)assert.equal((await fetch(base+route,{headers})).status,403,route+' must not infer a legacy quote provider');
  assert.equal((await readPortfolio(db,owner.id)).holdings[isin],1);
 }finally{await app?.close();await db?.$disconnect();await admin.$executeRawUnsafe('DROP SCHEMA "'+schema+'" CASCADE');await admin.$disconnect()}
});

