import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,persistHistoricalSnapshot,persistHistoricalReplay,initializePaperLedger,listBacktestRuns,readBacktestResult,readBacktestInstrument} from '../packages/database/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
test('backtest result reads are owner scoped, revision pinned and preserve missing performance',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),{input,assumptions,signalDate}=historicalReplayFixture();input.historyFrom=input.from;input.from=signalDate;input.fees.slippageBps='10';
  const stored=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),runs=await Promise.all([persistHistoricalReplay(db,owner.id,stored.id,assumptions.filter(a=>a.session>=input.from)),persistHistoricalReplay(db,owner.id,stored.id,assumptions.filter(a=>a.session>=input.from))]),run=runs[0];assert.equal(run.id,runs[1].id);
  const list=await listBacktestRuns(db,owner.id);assert.equal(list.items.filter(r=>r.id===run.id).length,1);assert.equal(list.items.find(r=>r.id===run.id).standardSlippage,true);assert.equal(list.items.find(r=>r.id===run.id).evaluationAsOf,new Date(input.knownAt).toISOString());assert.equal((await listBacktestRuns(db,randomUUID())).items.length,0);
  const empty=await readBacktestResult(db,owner.id,run.id,input.knownAt);assert.equal(empty.state,'UNKNOWN');assert.equal(empty.report,null);assert.ok(empty.reasons.includes('PAPER_LEDGER_NOT_FOUND'));
  await assert.rejects(readBacktestResult(db,randomUUID(),run.id,input.knownAt),/REPLAY_RUN_NOT_FOUND/);await assert.rejects(readBacktestResult(db,owner.id,run.id,'2030-01-01T00:00:00Z'),/REPLAY_OUTSIDE_SNAPSHOT/);
  const initial=await initializePaperLedger(db,owner.id,run.id,'100000');const report=await readBacktestResult(db,owner.id,run.id,input.knownAt);assert.equal(report.report.ledgerRevision,initial.revision);assert.equal(report.report.closedTrades,0);assert.equal(report.report.expectancyR,null);assert.equal(report.executable,false);
  const isin=input.universes[0].isins[0],detail=await readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt);assert.ok(detail.bars.length>100);assert.equal(detail.dataRevision,report.dataRevision);assert.equal(detail.ledgerRevision,report.report.ledgerRevision);assert.equal(detail.fills.length,0);
  const earlier=await readBacktestInstrument(db,owner.id,run.id,isin,signalDate+'T03:45:00Z');assert.ok(earlier.bars.length<detail.bars.length);assert.ok(earlier.bars.every(b=>b.session<signalDate));
  const next=await persistHistoricalSnapshot(db,owner.id,randomUUID(),{...input,raw:input.raw.map((b,i)=>i===0?{...b,revisionId:b.revisionId+'-corrected'}:b)});assert.notEqual(next.snapshot.dataRevision,report.dataRevision);assert.deepEqual(await readBacktestInstrument(db,owner.id,run.id,isin,input.knownAt),detail);
 }finally{await db.$disconnect()}
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
