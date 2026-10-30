import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,assertCandlePermissions,persistSource,ingestCandles,createSyncRun,persistAdjustment,recordPortfolioRisk,readPortfolio} from '../packages/database/dist/index.js';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {processBackfillWindow} from '../apps/worker/dist/backfill.js';
import {candlePermission} from '../fixtures/candle-permission.mjs';

test('risk snapshot quote storage requires live rights and rechecks after owner lock waits',async()=>{
 const fixture=await isolatedDatabase('risk_permissions'),db=fixture.db;
 try{
  const owner=await db.owner.findFirstOrThrow(),provider='synthetic-risk-rights-'+randomUUID(),at=new Date().toISOString(),isin='INE000000001';
  const quote={listingId:randomUUID(),provider,token:'1',mappingRevision:'a'.repeat(64),rawLtp:'1100',priceDecimals:2,ltp:'11.000000',sourceAt:at,receivedAt:at,decidedAt:at,session:at.slice(0,10),sequence:'1',quality:'FRESH',connection:'CONNECTED',executable:false,validUntil:new Date(Date.now()+30000).toISOString()};
  const quotes={[isin]:quote},counts=()=>db.$queryRaw`SELECT count(*)::text AS count FROM "PortfolioRiskSnapshot" WHERE "ownerId"=${owner.id}::uuid`;
  const journal=await readPortfolio(db,owner.id),empty=await counts();
  await assert.rejects(recordPortfolioRisk(db,owner.id,quotes),/SOURCE_PERMISSION_REQUIRED/);assert.deepEqual(await counts(),empty);
  await assert.rejects(recordPortfolioRisk(db,owner.id,{[isin]:{...quote,provider:undefined}}),/SOURCE_LINEAGE_MISSING/);assert.deepEqual(await counts(),empty);
  const {id,...grant}=await candlePermission(db,provider,{DISPLAY:false});assert.ok(id);
  await assert.rejects(recordPortfolioRisk(db,owner.id,quotes),/SOURCE_PERMISSION_REQUIRED/,'Candle rights cannot authorize live quotes');
  const publish=async uses=>{await new Promise(resolve=>setTimeout(resolve,5));return persistSource(db,{...grant,dataset:'LIVE_QUOTES',knownAt:new Date().toISOString(),uses:{...grant.uses,...uses}})};
  await publish({});assert.deepEqual((await recordPortfolioRisk(db,owner.id,quotes)).quotes,quotes);const stored=await counts();
  for(const right of ['STORE','DERIVE']){await publish({[right]:false});await assert.rejects(recordPortfolioRisk(db,owner.id,quotes),/SOURCE_PERMISSION_REQUIRED/);assert.deepEqual(await counts(),stored)}
  await publish({});let locked,release,entered;
  const ready=new Promise(resolve=>{locked=resolve}),gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
  const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${owner.id}::uuid FOR UPDATE`;locked();await gate},{timeout:30000});await ready;
  const waitingDb={$queryRaw:db.$queryRaw.bind(db),$transaction:(callback,options)=>db.$transaction(tx=>{entered();return callback(tx)},options)};
  const denied=assert.rejects(recordPortfolioRisk(waitingDb,owner.id,quotes),/SOURCE_PERMISSION_REQUIRED/);
  try{await started;await publish({STORE:false})}finally{release();await holder}
  await denied;assert.deepEqual(await counts(),stored);
  assert.deepEqual((await recordPortfolioRisk(db,owner.id,{})).quotes,{});const after=await readPortfolio(db,owner.id);assert.deepEqual(after.events,journal.events);assert.deepEqual(after.holdings,journal.holdings);assert.equal(after.cash,journal.cash);
  await publish({});assert.deepEqual((await recordPortfolioRisk(db,owner.id,quotes)).quotes,quotes);
 }finally{await fixture.close()}
});
test('actual candle lineage scopes rights; missing, ambiguous and expired grants block derived use',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const provider='synthetic-permission-'+randomUUID(),id=randomUUID();await db.candleRevision.create({data:{id,listingId:randomUUID(),session:new Date('2026-01-01'),scale:'RAW',revision:1,open:'1',high:'1',low:'1',close:'1',volume:1n,source:provider,receivedAt:new Date(),finalizedAt:new Date('2026-01-01T10:30:00Z')}});
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(assertCandlePermissions(db,[randomUUID()],['DISPLAY']),/SOURCE_LINEAGE_MISSING/);
  await assert.rejects(assertCandlePermissions(db,['not-a-revision'],['DISPLAY']),/SOURCE_LINEAGE_MISSING/);
  const grant=await candlePermission(db,provider);assert.deepEqual((await assertCandlePermissions(db,[id],['DERIVE','STORE'])).sourceSnapshotIds,[grant.id]);
  const {id:grantId,...metadata}=grant;assert.ok(grantId);await persistSource(db,{...metadata,uses:{...metadata.uses,DISPLAY:false}});
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_SCOPE_AMBIGUOUS/,'Equal-time conflicting grants must not be resolved by arbitrary hash order');
  const knownAt=new Date().toISOString(),denial=await persistSource(db,{...metadata,knownAt,uses:{...metadata.uses,DISPLAY:false}});
  assert.deepEqual((await assertCandlePermissions(db,[id],['DERIVE'])).sourceSnapshotIds,[denial.id]);
  await assert.rejects(assertCandlePermissions(db,[id],['DISPLAY']),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(assertCandlePermissions(db,[id],['DERIVE'],metadata.validUntil),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await db.$disconnect()}
});

test('adjustment persistence requires current raw-source derivation and storage rights, including retries',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const listingId=randomUUID(),revisionId=randomUUID(),provider='synthetic-adjustment-'+randomUUID(),date='2025-01-02',asOf='2025-01-03T00:00:00Z';
  const raw={listingId,provider,session:date,revisionId,open:'10',high:'12',low:'9',close:'11',volume:'100',receivedAt:asOf,finalizedAt:date+'T10:30:00Z',zeroVolumeVerified:false};
  await db.candleRevision.create({data:{id:revisionId,listingId,session:new Date(date),scale:'RAW',revision:1,open:raw.open,high:raw.high,low:raw.low,close:raw.close,volume:100n,source:provider,receivedAt:new Date(asOf),finalizedAt:new Date(raw.finalizedAt)}});
  const input={listingId,asOf,scaleSession:date,raw:[raw],source:{id:'synthetic-no-actions',listingId,knownAt:asOf,verified:true,sourceReference:'synthetic',coverageFrom:date,coverageThrough:date,actions:[]}};
  const counts=()=>db.$queryRaw`SELECT (SELECT count(*) FROM "AdjustmentSnapshot" WHERE "listingId"=${listingId}::uuid)::text AS snapshots,(SELECT count(*) FROM "AdjustedDailyCandle" WHERE "rawRevisionId"=${revisionId}::uuid)::text AS candles`;
  const empty=await counts();await assert.rejects(persistAdjustment(db,input),/SOURCE_PERMISSION_REQUIRED/);assert.deepEqual(await counts(),empty);
  const {id,...grant}=await candlePermission(db,provider,{DISPLAY:false});assert.ok(id);
  const saved=await persistAdjustment(db,input);assert.equal(saved.state,'KNOWN');assert.equal(saved.bars[0].close,'11.000000');const stored=await counts();
  for(const permission of ['DERIVE','STORE']){
   await new Promise(resolve=>setTimeout(resolve,5));await persistSource(db,{...grant,knownAt:new Date().toISOString(),uses:{...grant.uses,[permission]:false}});
   await assert.rejects(persistAdjustment(db,input),/SOURCE_PERMISSION_REQUIRED/);
   await assert.rejects(persistAdjustment(db,{...input,source:{...input.source,id:randomUUID()}}),/SOURCE_PERMISSION_REQUIRED/);
   assert.deepEqual(await counts(),stored);
  }
  await new Promise(resolve=>setTimeout(resolve,5));await persistSource(db,{...grant,knownAt:new Date().toISOString()});
  assert.deepEqual(await persistAdjustment(db,input),saved);
 }finally{await db.$disconnect()}
});

test('direct candle storage checks current grants and rolls back changes on revocation',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const listingId=randomUUID(),provider='synthetic-storage-'+randomUUID(),date='2025-01-02',asOf='2025-01-03T00:00:00Z';
  const calendar=[{date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2025-01-01T00:00:00Z',source:'synthetic',verified:true}];
  const bar={listingId,provider,session:date,open:'10',high:'12',low:'9',close:'11',volume:'100',receivedAt:asOf,finalizedAt:calendar[0].finalizedAt,zeroVolumeVerified:false};
  const input={listingId,provider,calendar,from:date,to:date,asOf,bars:[bar]};
  const counts=async()=>({revisions:await db.candleRevision.count({where:{listingId}}),rows:await db.$queryRaw`SELECT (SELECT count(*) FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid)::text AS raw,(SELECT count(*) FROM "CandleQuarantine" WHERE "listingId"=${listingId}::uuid)::text AS quarantine,(SELECT count(*) FROM "CandleChangeOutbox" WHERE "listingId"=${listingId}::uuid)::text AS outbox,(SELECT count(*) FROM "CandleCoverage" WHERE "listingId"=${listingId}::uuid)::text AS coverage`});
  const empty=await counts();await assert.rejects(ingestCandles(db,input),/SOURCE_PERMISSION_REQUIRED/);assert.deepEqual(await counts(),empty);
  const {id,...grant}=await candlePermission(db,provider,{DISPLAY:false,DERIVE:false});assert.ok(id);
  assert.equal((await ingestCandles(db,input)).inserted,1);const stored=await counts();
  const publish=async uses=>{await new Promise(resolve=>setTimeout(resolve,5));return persistSource(db,{...grant,knownAt:new Date().toISOString(),uses:{...grant.uses,...uses}})};
  await publish({STORE:false,DERIVE:true,DISPLAY:true});
  await assert.rejects(ingestCandles(db,input),/SOURCE_PERMISSION_REQUIRED/); // Historical asOf and idempotency do not bypass revocation.
  await assert.rejects(ingestCandles(db,{...input,bars:[{...bar,high:'1'}]}),/SOURCE_PERMISSION_REQUIRED/);
  assert.deepEqual(await counts(),stored);
  await publish({STORE:true});
  await assert.rejects(ingestCandles(db,{...input,bars:[{...bar,provider:'unlicensed-'+randomUUID()}]}),/SOURCE_PERMISSION_REQUIRED/);assert.deepEqual(await counts(),stored);
  const changedAt='2025-01-03T01:00:00Z',changed={...input,asOf:changedAt,bars:[{...bar,close:'10',receivedAt:changedAt}]};
  await assert.rejects(ingestCandles(db,changed,async()=>{await publish({STORE:false})}),/SOURCE_PERMISSION_REQUIRED/);
  assert.deepEqual(await counts(),stored,'A revocation before commit rolls back revisions, outbox and coverage');
  assert.equal((await db.$queryRaw`SELECT "close"::text AS close FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid`)[0].close,'11.000000');
  await publish({STORE:true});
  let locked,release,entered;const lockReady=new Promise(resolve=>{locked=resolve}),gate=new Promise(resolve=>{release=resolve}),transactionEntered=new Promise(resolve=>{entered=resolve});
  const holder=db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${listingId},0))`;locked();await gate},{timeout:30000});
  await lockReady;
  const waitingDb={$queryRaw:db.$queryRaw.bind(db),$transaction:(callback,options)=>db.$transaction(tx=>{entered();return callback(tx)},options)};
  const denied=assert.rejects(ingestCandles(waitingDb,changed),/SOURCE_PERMISSION_REQUIRED/);
  try{await transactionEntered;await publish({STORE:false})}finally{release();await holder}
  await denied;assert.deepEqual(await counts(),stored,'A writer waiting on the listing lock must see the new denial');
  await publish({STORE:true});assert.equal((await ingestCandles(db,changed)).revised,1);
  const runId=randomUUID(),workerListing=randomUUID();
  await createSyncRun(db,{id:runId,listingId:workerListing,provider,from:date,to:date,asOf,calendar,windows:[{from:date,to:date,sessions:[date]}]});
  const outcome=await processBackfillWindow(db,runId,{now:()=>asOf,fetch:async()=>{await publish({STORE:false});return [{...bar,listingId:workerListing}]}});
  assert.equal(outcome.state,'FAILED');assert.equal(outcome.reason,'SOURCE_PERMISSION_REQUIRED');
  const checkpoint=(await db.$queryRaw`SELECT "state","reason","leaseToken" FROM "HistoricalSyncWindow" WHERE "id"=${outcome.windowId}::uuid`)[0];
  assert.deepEqual(checkpoint,{state:'PARTIAL',reason:'SOURCE_PERMISSION_REQUIRED',leaseToken:null});
  assert.equal(await db.candleRevision.count({where:{listingId:workerListing}}),0);
 }finally{await db.$disconnect()}
});
