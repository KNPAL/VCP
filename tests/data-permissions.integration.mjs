import {lockHistoricalAuthority} from '../packages/database/dist/backtest-snapshots.js';
import {permittedCandles as ingestCandles} from '../fixtures/reference-source.mjs';
import {assertActionPermissions} from '../packages/database/dist/data-permissions.js';
import {actionPermission} from '../fixtures/candle-permission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,assertCandlePermissions,persistSource,createSyncRun,persistAdjustment,recordPortfolioRisk,readPortfolio,persistSectors,getSector,persistUniverse} from '../packages/database/dist/index.js';
import {authorizedUniverseAt,assertUniversePermission} from '../packages/database/dist/instruments.js';
import {persistInstrumentSnapshot,authorizeInstrumentRows} from '../packages/database/dist/index.js';
import {masterFixture} from '../fixtures/instrument-master.mjs';
import {persistHistoricalSnapshot,readHistoricalSlice} from '../packages/database/dist/index.js';
import {ingestCandles as ingestUnboundCandles,authorizeCalendarRows} from '../packages/database/dist/index.js';
import {referenceSource} from '../fixtures/reference-source.mjs';
import {isolatedDatabase} from '../fixtures/isolated-database.mjs';
import {processBackfillWindow} from '../apps/worker/dist/backfill.js';
import {candlePermission} from '../fixtures/candle-permission.mjs';

test('calendar grants gate operational ingestion and mask revoked calendars without older fallback',async()=>{
 const fixture=await isolatedDatabase('calendar_permissions'),db=fixture.db;
 try{
  const provider='calendar-fixture',listingId=randomUUID(),date='2025-01-02',asOf='2025-01-02T11:00:00Z';await candlePermission(db,provider);
  const calendar=[{date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2025-01-01T00:00:00Z',source:'synthetic',verified:true}];
  const input={listingId,provider,calendar,from:date,to:date,asOf,bars:[]};
  await assert.rejects(ingestUnboundCandles(db,input),/SOURCE_LINEAGE_MISSING/);
  const source=await referenceSource(db,'EXCHANGE_CALENDAR',calendar[0].knownAt),grant=await persistSource(db,source);calendar[0].sourceSnapshotId=grant.id;
  await ingestUnboundCandles(db,input);assert.equal((await authorizeCalendarRows(db,[{id:'selected',evidence:calendar}]))[0].evidence.length,1);
  await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false,DERIVE:false,DISPLAY:false}});
  const hidden=(await authorizeCalendarRows(db,[{id:'selected',evidence:calendar}]))[0];assert.equal(hidden.id,'selected');assert.deepEqual(hidden.evidence,[]);
  await assert.rejects(ingestUnboundCandles(db,input),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await fixture.close()}
});

test('historical calendar authority is required for archive storage, retries and direct reads',async()=>{
 const fixture=await isolatedDatabase('archive_permissions'),db=fixture.db;
 try{
  const owner=await db.owner.findFirstOrThrow(),knownAt=new Date(Date.now()-1000).toISOString(),date=knownAt.slice(0,10),request=randomUUID();
  const input={from:date,through:date,knownAt,strategySha:'a'.repeat(40),strategyConfiguration:{version:4},seed:42,fees:{buyBps:'1',sellBps:'1',slippageBps:'1',minimumFee:'0',sourceReference:'synthetic'},historicalDelistingsVerified:false,universes:[],instruments:[],actions:[],raw:[],calendar:[{date,kind:'HOLIDAY',opensAt:null,closesAt:null,finalizedAt:null,knownAt,source:'synthetic',verified:true}]};
  await assert.rejects(persistHistoricalSnapshot(db,owner.id,request,input),/SOURCE_LINEAGE_MISSING/);
  const source=await referenceSource(db,'EXCHANGE_CALENDAR',knownAt),registered=await persistSource(db,source);input.calendar[0].sourceSnapshotId=registered.id;
  const saved=await persistHistoricalSnapshot(db,owner.id,request,input);await readHistoricalSlice(db,owner.id,saved.id,knownAt);
  await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false,DISPLAY:false}});
  await assert.rejects(readHistoricalSlice(db,owner.id,saved.id,knownAt),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(persistHistoricalSnapshot(db,owner.id,request,input),/SOURCE_PERMISSION_REQUIRED/);
 }finally{await fixture.close()}
});

test('instrument masters cannot bypass registration and revocation masks the selected revision',async()=>{
 const fixture=await isolatedDatabase('master_permissions'),db=fixture.db;
 try{
  const knownAt=new Date(Date.now()-1000).toISOString(),input={knownAt,sourceReference:'synthetic-master',rows:masterFixture(knownAt).mappings};
  await assert.rejects(persistInstrumentSnapshot(db,input),/INSTRUMENT_STORAGE_PERMISSION_REQUIRED/);
  const source=await referenceSource(db,'instrument-master',knownAt),snapshot=await persistInstrumentSnapshot(db,{...input,source});
  assert.equal((await authorizeInstrumentRows(db,[{evidence:snapshot}]))[0].evidence.rows.length,1);
  await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false,DERIVE:false,DISPLAY:false}});
  const hidden=(await authorizeInstrumentRows(db,[{evidence:snapshot}]))[0].evidence;
  assert.equal(hidden.id,snapshot.id);assert.deepEqual(hidden.rows,[]);
  await assert.rejects(persistInstrumentSnapshot(db,{...input,source}),/INSTRUMENT_STORAGE_PERMISSION_REQUIRED/);
 }finally{await fixture.close()}
});

test('universe membership requires registered rights and never falls back after revocation',async()=>{
 const fixture=await isolatedDatabase('universe_permissions'),db=fixture.db;
 try{
  const knownAt=new Date(Date.now()-1000).toISOString(),input={universe:'NIFTY_500',knownAt,effectiveFrom:'2020-01-01',effectiveTo:null,sourceReference:'synthetic',historicalConstituentsVerified:true,isins:['INE000000001']};
  await assert.rejects(persistUniverse(db,input),/UNIVERSE_STORAGE_PERMISSION_REQUIRED/);
  const source=await referenceSource(db,'UNIVERSE',knownAt),saved=await persistUniverse(db,{...input,source});
  assert.deepEqual((await authorizedUniverseAt(db,[saved],knownAt)).members,input.isins);
  await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false,DERIVE:false,DISPLAY:false}});
  const hidden=await authorizedUniverseAt(db,[saved],knownAt);assert.equal(hidden.state,'UNKNOWN');assert.deepEqual(hidden.members,[]);
  await assert.rejects(assertUniversePermission(db,saved.id,['DISPLAY']),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(persistUniverse(db,{...input,source}),/UNIVERSE_STORAGE_PERMISSION_REQUIRED/);
  assert.equal(await db.universeSnapshot.count(),1);
 }finally{await fixture.close()}
});

test('sector authority gates storage and historical reads; revocation cannot leave known sectors',async()=>{
 const fixture=await isolatedDatabase('sector_permissions'),db=fixture.db;
 try{
  const at=new Date(Date.now()-1000).toISOString(),isin='INE000000001',mappings=[{isin,sector:'TECH',validFrom:'2020-01-01',validTo:null,knownAt:at,sourceReference:'synthetic'}];
  await assert.rejects(persistSectors(db,mappings,at),/SECTOR_STORAGE_PERMISSION_REQUIRED/);
  const source=await referenceSource(db,'SECTORS',at);
  const saved=await persistSectors(db,mappings,at,source);assert.equal((await persistSectors(db,mappings,at,source)).id,saved.id);
  assert.equal((await getSector(db,isin)).sector,'TECH');
  await persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false,DISPLAY:false,DERIVE:false}});
  assert.equal((await getSector(db,isin,at)).status,'UNKNOWN');
  await assert.rejects(persistSectors(db,mappings,at,source),/SECTOR_STORAGE_PERMISSION_REQUIRED/);
  assert.equal(await db.sectorSnapshot.count(),1);
 }finally{await fixture.close()}
});

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
  const input={listingId,asOf,scaleSession:date,raw:[raw],source:{sourceSnapshotId:await actionPermission(db),id:'synthetic-no-actions',listingId,knownAt:asOf,verified:true,sourceReference:'synthetic',coverageFrom:date,coverageThrough:date,actions:[]}};
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
  for(const sourceSnapshotId of [undefined,id]){
   await assert.rejects(persistAdjustment(db,{...input,source:{...input.source,sourceSnapshotId}}),/ACTION_SOURCE_PERMISSION_REQUIRED/);
  }
  await assertActionPermissions(db,[saved.revision],['DISPLAY']);
  const [authority]=await db.$queryRaw`SELECT evidence FROM "SourceSnapshot" WHERE id=${input.source.sourceSnapshotId}`;
  await persistSource(db,{...authority.evidence,knownAt:new Date().toISOString(),uses:{...authority.evidence.uses,STORE:false}});
  await assert.rejects(persistAdjustment(db,input),/ACTION_SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(assertActionPermissions(db,[saved.revision],['DERIVE']),/SOURCE_PERMISSION_REQUIRED/);
  assert.deepEqual(await counts(),stored);
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


test('archive authority locks hold raw and reference revocations until commit',async()=>{
 const fixture=await isolatedDatabase('archive_authority_lock'),db=fixture.db;
 try{
  const raw=await candlePermission(db,'archive-lock-'+randomUUID()),calendar=await candlePermission(db,'calendar-lock-'+randomUUID(),{},'EXCHANGE_CALENDAR');
  const input={raw:[{provider:raw.provider}],instruments:[],universes:[],calendar:[{sourceSnapshotId:calendar.id}],actions:[]};
  let release,acquired;const ready=new Promise(resolve=>{acquired=resolve}),hold=new Promise(resolve=>{release=resolve});
  const transaction=db.$transaction(async tx=>{await lockHistoricalAuthority(tx,input);acquired();await hold},{timeout:10000});
  await ready;
  const writes=[raw,calendar].map(({id,...source})=>{assert.ok(id);return persistSource(db,{...source,knownAt:new Date().toISOString(),uses:{...source.uses,STORE:false}})});
  try{
   const outcome=await Promise.race([Promise.any(writes).then(()=> 'committed'),new Promise(resolve=>setTimeout(()=>resolve('waiting'),150))]);
   assert.equal(outcome,'waiting','Registry writers must wait for archive transaction completion');
  }finally{release();await transaction;await Promise.all(writes)}
 }finally{await fixture.close()}
});
