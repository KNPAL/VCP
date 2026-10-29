import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createApp} from '../apps/api/dist/app.js';
import {candlePermission} from '../fixtures/candle-permission.mjs';
import {PrismaClient,persistSource,persistHistoricalSnapshot,persistHistoricalReplay,initializePaperLedger,listBacktestRuns,readBacktestResult,readBacktestInstrument} from '../packages/database/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
test('backtest result reads are owner scoped, revision pinned and preserve missing performance',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();let app;
 try{
  const owner=await db.owner.findFirstOrThrow(),{input,assumptions,signalDate}=historicalReplayFixture();input.historyFrom=input.from;input.from=signalDate;input.fees.slippageBps='10';const provider='synthetic-backtest-'+randomUUID(),grant=await candlePermission(db,provider);input.raw=input.raw.map(bar=>({...bar,provider}));
  const stored=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),runs=await Promise.all([persistHistoricalReplay(db,owner.id,stored.id,assumptions.filter(a=>a.session>=input.from)),persistHistoricalReplay(db,owner.id,stored.id,assumptions.filter(a=>a.session>=input.from))]),run=runs[0];assert.equal(run.id,runs[1].id);
  const list=await listBacktestRuns(db,owner.id);assert.equal(list.items.filter(r=>r.id===run.id).length,1);assert.equal(list.items.find(r=>r.id===run.id).standardSlippage,true);assert.equal(list.items.find(r=>r.id===run.id).evaluationAsOf,new Date(input.knownAt).toISOString());assert.equal((await listBacktestRuns(db,randomUUID())).items.length,0);
  const empty=await readBacktestResult(db,owner.id,run.id,input.knownAt);assert.equal(empty.state,'UNKNOWN');assert.equal(empty.report,null);assert.ok(empty.reasons.includes('PAPER_LEDGER_NOT_FOUND'));
  await assert.rejects(readBacktestResult(db,randomUUID(),run.id,input.knownAt),/REPLAY_RUN_NOT_FOUND/);await assert.rejects(readBacktestResult(db,owner.id,run.id,'2030-01-01T00:00:00Z'),/REPLAY_OUTSIDE_SNAPSHOT/);
  const initial=await initializePaperLedger(db,owner.id,run.id,'100000');const report=await readBacktestResult(db,owner.id,run.id,input.knownAt);assert.equal(report.report.ledgerRevision,initial.revision);assert.equal(report.report.closedTrades,0);assert.equal(report.report.expectancyR,null);assert.equal(report.executable,false);
  const isin=input.universes[0].isins[0],detail=await readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt);assert.ok(detail.bars.length>100);assert.equal(detail.dataRevision,report.dataRevision);assert.equal(detail.ledgerRevision,report.report.ledgerRevision);assert.equal(detail.fills.length,0);
  const earlier=await readBacktestInstrument(db,owner.id,run.id,isin,signalDate+'T03:45:00Z');assert.ok(earlier.bars.length<detail.bars.length);assert.ok(earlier.bars.every(b=>b.session<signalDate));
  const token=randomBytes(32).toString('hex'),csrf='synthetic-csrf',digest=value=>createHash('sha256').update(value).digest('hex'),origin='http://127.0.0.1:3199';
  await db.session.create({data:{id:digest(token),ownerId:owner.id,csrfHash:digest(csrf),expiresAt:new Date(Date.now()+60000)}});
  app=await createApp({db,secure:false,origin,logSink:()=>{}});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={cookie:'vcp_session='+token,origin,'x-csrf-token':csrf,'content-type':'application/json'},routes=['/api/v1/backtests/'+run.id+'?asOf='+input.knownAt,'/api/v1/backtests/'+run.id+'/instruments/'+isin+'?asOf='+input.knownAt];
  for(const route of routes){const response=await fetch(base+route,{headers});assert.equal(response.status,200);await response.json()}
  const next=await persistHistoricalSnapshot(db,owner.id,randomUUID(),{...input,raw:input.raw.map((b,i)=>i===0?{...b,revisionId:b.revisionId+'-corrected'}:b)});assert.notEqual(next.snapshot.dataRevision,report.dataRevision);assert.deepEqual(await readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt),detail);
  const {id:grantId,...metadata}=grant;assert.ok(grantId);await persistSource(db,{...metadata,knownAt:new Date().toISOString(),uses:{...metadata.uses,DISPLAY:false}});
  await assert.rejects(readBacktestResult(db,owner.id,run.id,input.knownAt),/SOURCE_PERMISSION_REQUIRED/);await assert.rejects(readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt),/SOURCE_PERMISSION_REQUIRED/);
  for(const route of routes){const response=await fetch(base+route,{headers});assert.equal(response.status,403);const value=await response.json();assert.equal(value.error.code,'FORBIDDEN');assert.equal(Object.hasOwn(value,'bars'),false);assert.equal(Object.hasOwn(value,'report'),false)}
  const comparison=await fetch(base+'/api/v1/backtests/compare',{method:'POST',headers,body:JSON.stringify({train:run.id,validation:'b'.repeat(64),test:'c'.repeat(64)})});assert.equal(comparison.status,403);
  assert.ok((await listBacktestRuns(db,owner.id)).items.some(item=>item.id===run.id),'Metadata remains visible without licensed prices');
  await persistSource(db,{...metadata,knownAt:new Date().toISOString(),uses:{...metadata.uses,STORE:false}});
  const countBefore=await db.$queryRaw`SELECT (SELECT count(*)::int FROM "HistoricalReplaySnapshot") AS snapshots,(SELECT count(*)::int FROM "HistoricalReplayRun") AS runs`;
  await assert.rejects(persistHistoricalSnapshot(db,owner.id,randomUUID(),input),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(persistHistoricalSnapshot(db,owner.id,stored.requestId,input),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(persistHistoricalReplay(db,owner.id,stored.id,assumptions.filter(a=>a.session>=input.from)),/SOURCE_PERMISSION_REQUIRED/);
  await assert.rejects(persistHistoricalReplay(db,owner.id,stored.id,[]),/SOURCE_PERMISSION_REQUIRED/);
  assert.deepEqual(await db.$queryRaw`SELECT (SELECT count(*)::int FROM "HistoricalReplaySnapshot") AS snapshots,(SELECT count(*)::int FROM "HistoricalReplayRun") AS runs`,countBefore);
  assert.ok((await readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt)).bars.length>0,'DISPLAY/DERIVE permissions are independent of new-storage permission');
  await persistSource(db,{...metadata,knownAt:new Date().toISOString()});
  let entered,waiting;const enteredTransaction=new Promise(resolve=>{entered=resolve});
  const delayed={$queryRaw:db.$queryRaw.bind(db),$transaction:(callback,options)=>{entered();return db.$transaction(callback,options)}};
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${owner.id}::uuid FOR UPDATE`;
   waiting=assert.rejects(persistHistoricalSnapshot(delayed,owner.id,randomUUID(),input),/SOURCE_PERMISSION_REQUIRED/);
   await enteredTransaction;
   await persistSource(db,{...metadata,knownAt:new Date().toISOString(),uses:{...metadata.uses,STORE:false}});
  });
  await waiting;
  assert.deepEqual(await db.$queryRaw`SELECT (SELECT count(*)::int FROM "HistoricalReplaySnapshot") AS snapshots,(SELECT count(*)::int FROM "HistoricalReplayRun") AS runs`,countBefore,'Revocation during an owner-lock wait must not persist an archive');
 }finally{await app?.close();await db.$disconnect()}
});


import {compareBacktestSelection} from '../packages/database/dist/index.js';
import {ST_VCP_4_0} from '../packages/strategy/dist/index.js';
test('training selection enforces owner, standard costs, distinct chronological windows and stable repeat results',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow();
  async function make(day,fees={buyBps:'1',sellBps:'2',slippageBps:'10',minimumFee:'0',sourceReference:'synthetic-costs'},initialize=true){
   const input={from:day,through:day,knownAt:day+'T11:00:00Z',strategySha:'a'.repeat(40),strategyConfiguration:ST_VCP_4_0,seed:7,fees,historicalDelistingsVerified:false,universes:[],instruments:[],actions:[],raw:[],calendar:[{date:day,kind:'TRADING',opensAt:day+'T03:45:00Z',closesAt:day+'T10:00:00Z',finalizedAt:day+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic',verified:true}]};
   const snapshot=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),run=await persistHistoricalReplay(db,owner.id,snapshot.id);if(initialize)await initializePaperLedger(db,owner.id,run.id,'100000');return run.id;
  }
  const train=await make('2026-10-19'),validation=await make('2026-10-20'),test=await make('2026-10-21'),selection={train,validation,test};
  const first=await compareBacktestSelection(db,owner.id,selection);assert.equal(first.selectionUsesOutOfSample,false);assert.equal(first.folds[0].state,'INSUFFICIENT_TRAINING_EVIDENCE');assert.equal(first.folds[0].candidates[0].train.expectancyR,null);assert.equal(first.standardSlippageBps,'10');assert.deepEqual(await compareBacktestSelection(db,owner.id,selection),first);
  await assert.rejects(compareBacktestSelection(db,randomUUID(),selection),/REPLAY_RUN_NOT_FOUND/);
  for(const invalid of [null,{}, {...selection,metric:'999'},{...selection,test:train}])await assert.rejects(compareBacktestSelection(db,owner.id,invalid),/INVALID_BACKTEST_SELECTION/);
  await assert.rejects(compareBacktestSelection(db,owner.id,{train:test,validation,test:train}),/WINDOW_OVERLAP/);
  const costs={buyBps:'1',sellBps:'2',slippageBps:'9',minimumFee:'0',sourceReference:'synthetic-costs'},other=await make('2026-10-22',costs);await assert.rejects(compareBacktestSelection(db,owner.id,{...selection,test:other}),/STANDARD_COSTS_REQUIRED/);
  const changed=await make('2026-10-22',{...costs,slippageBps:'10',buyBps:'2'});await assert.rejects(compareBacktestSelection(db,owner.id,{...selection,test:changed}),/CONFIGURATION_MISMATCH/);
  const missing=await make('2026-10-22',{...costs,slippageBps:'10'},false);await assert.rejects(compareBacktestSelection(db,owner.id,{...selection,test:missing}),/PAPER_LEDGER_NOT_FOUND/);
 }finally{await db.$disconnect()}
});
