import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,persistHistoricalSnapshot,readHistoricalSlice,persistHistoricalReplay,readHistoricalReplay,persistHistoricalEntry,persistHistoricalExit,initializePaperLedger,loadPaperLedger,applyHistoricalDecisionToPaper,applyPaperCorporateActions,persistPaperProtection,persistPaperDailyExit,persistPaperOpeningExit} from '../packages/database/dist/index.js';
import {readPaperLedger} from '../packages/backtest/dist/index.js';
import {runPaperSession,readPaperPerformance,compareStoredWalkForward} from '../packages/database/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
import {historicalEntryFixture} from '../fixtures/historical-entry.mjs';
import {valuePortfolio} from '../packages/portfolio/dist/index.js';
test('snapshot transaction survives retry/restart, rejects replacement and remains owner-scoped immutable evidence',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),requestId=randomUUID();
  const input={from:'2026-10-20',through:'2026-10-20',knownAt:'2026-10-20T11:00:00Z',strategySha:'a'.repeat(40),strategyConfiguration:{version:4},seed:42,fees:{buyBps:'1',sellBps:'2',slippageBps:'3',minimumFee:'0',sourceReference:'synthetic'},historicalDelistingsVerified:false,universes:[],instruments:[],calendar:[],actions:[],raw:[]};
  const results=await Promise.all([persistHistoricalSnapshot(db,owner.id,requestId,input),persistHistoricalSnapshot(db,owner.id,requestId,input)]);
  assert.equal(results[0].id,results[1].id);
  await assert.rejects(persistHistoricalSnapshot(db,owner.id,requestId,{...input,seed:99}),/SNAPSHOT_REQUEST_CONFLICT/);
  await assert.rejects(db.$executeRaw`UPDATE "HistoricalReplaySnapshot" SET "requestId"='changed' WHERE "id"=${results[0].id}::uuid`);
  await assert.rejects(readHistoricalSlice(db,randomUUID(),results[0].id,input.knownAt),/SNAPSHOT_NOT_FOUND/);
  const restarted=new PrismaClient();
  try{
   const restored=await readHistoricalSlice(restarted,owner.id,results[0].id,input.knownAt);
   assert.equal(restored.bias,'SURVIVORSHIP_BIASED_RESEARCH');assert.equal(restored.executable,false);
   assert.equal((await persistHistoricalSnapshot(restarted,owner.id,requestId,input)).id,results[0].id);
  }finally{await restarted.$disconnect()}
 }finally{await db.$disconnect()}
});
test('opening attempts bind stored signals and costs, deduplicate and never write the actual journal',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),{input,assumptions,signalDate,fillDate}=historicalReplayFixture();
  const extraDate=new Date(Date.parse(fillDate)+86400000).toISOString().slice(0,10),lastDay=input.calendar.at(-1);
  input.calendar.push({...lastDay,date:extraDate,opensAt:extraDate+'T03:45:00Z',closesAt:extraDate+'T10:00:00Z',finalizedAt:extraDate+'T10:30:00Z'});
  input.raw.push({...input.raw.at(-1),session:fillDate,open:'100.01',high:'102',low:'90',close:'100',receivedAt:fillDate+'T10:30:00Z',finalizedAt:fillDate+'T10:30:00Z',revisionId:'fill-day',revision:1});
  const stored=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),run=await persistHistoricalReplay(db,owner.id,stored.id,assumptions),events=await readHistoricalReplay(db,owner.id,run.id);
  const source=events.find(event=>event.session===signalDate),signal=source.results[0];
  assert.equal(signal.breakout.state,'BREAKOUT_CONFIRMED');
  const attempt=historicalEntryFixture();attempt.snapshotId=stored.snapshot.id;attempt.event=signal.breakout.event;attempt.now=signal.earliestFillAt;attempt.earliestFillAt=signal.earliestFillAt;attempt.fees=input.fees;
  attempt.opening={price:'100.01',sourceAt:attempt.now,knownAt:attempt.now,sourceReference:'synthetic-next-open'};
  attempt.portfolio=valuePortfolio({cash:'100000',cashVerified:true,reconciled:true,holdings:[],asOf:attempt.now});
  attempt.market.calendar=input.calendar.map(day=>({date:day.date,opensAt:day.opensAt,closesAt:day.closesAt}));
  const before=await db.$queryRaw`SELECT count(*)::text AS count FROM "PortfolioJournal"`;
  const results=await Promise.all([persistHistoricalEntry(db,owner.id,run.id,source.id,attempt),persistHistoricalEntry(db,owner.id,run.id,source.id,attempt)]);
  assert.equal(results[0].id,results[1].id);assert.equal(results[0].state,'SIMULATED_FILL');assert.ok(results[0].quantity>0);
  await assert.rejects(persistHistoricalEntry(db,owner.id,run.id,source.id,{...attempt,fees:{...attempt.fees,buyBps:'999'}}),/ENTRY_PIN_MISMATCH/);
  await assert.rejects(persistHistoricalEntry(db,owner.id,run.id,source.id,{...attempt,market:{...attempt.market,tick:'1'}}),/ENTRY_MARKET_PIN_MISMATCH/);
  await assert.rejects(persistHistoricalEntry(db,owner.id,run.id,source.id,{...attempt,opening:{...attempt.opening,price:'104'}}),/ENTRY_RETRY_CONFLICT/);
  await assert.rejects(persistHistoricalEntry(db,randomUUID(),run.id,source.id,attempt),/REPLAY_EVENT_NOT_FOUND/);
  const initial=await initializePaperLedger(db,owner.id,run.id,'100000');
  assert.equal((await initializePaperLedger(db,owner.id,run.id,'100000')).revision,initial.revision);
  await assert.rejects(initializePaperLedger(db,owner.id,run.id,'999'),/CAPITAL_ALREADY_PINNED/);
  const ledgers=await Promise.all([applyHistoricalDecisionToPaper(db,owner.id,run.id,'ENTRY',results[0].id,initial.revision),applyHistoricalDecisionToPaper(db,owner.id,run.id,'ENTRY',results[0].id,initial.revision)]);
  assert.equal(ledgers[0].revision,ledgers[1].revision);assert.equal(ledgers[0].events.length,2);
  const plans=await Promise.all([persistPaperProtection(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z'),persistPaperProtection(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z')]);
  assert.equal(plans[0].id,plans[1].id);assert.ok(Date.parse(plans[0].effectiveAt)>Date.parse(plans[0].decidedAt));
  await assert.rejects(persistPaperProtection(db,owner.id,run.id,attempt.isin,fillDate+'T10:59:00Z'),/PAPER_PROTECTION_RETRY_CONFLICT/);
  await assert.rejects(persistPaperProtection(db,owner.id,run.id,attempt.isin,signalDate+'T11:00:00Z'),/PAPER_PROTECTION_NOT_CHRONOLOGICAL/);
  await assert.rejects(db.$executeRaw`DELETE FROM "PaperProtectionPlan" WHERE "id"=${plans[0].id}`);
  const exitInput={snapshotId:stored.snapshot.id,strategyRevision:stored.snapshot.strategyHash,dataRevision:stored.snapshot.dataRevision,asOf:fillDate+'T11:00:00Z',position:{id:results[0].id,listingId:attempt.event.listingId,quantity:results[0].quantity,entry:results[0].price,initialStop:results[0].stop,activeStop:results[0].stop,scaleSession:fillDate,stopEffectiveAt:attempt.now,partialTaken:false},bar:input.raw.at(-1),calendar:lastDay,actions:input.actions[0],tick:'0.05',lotSize:1,liquidity:'TRADABLE',scheduledSell:null,fees:input.fees,bias:null};
  const fabricated=await persistHistoricalExit(db,owner.id,run.id,exitInput);
  await assert.rejects(applyHistoricalDecisionToPaper(db,owner.id,run.id,'EXIT',fabricated.id,ledgers[0].revision),/PAPER_EXIT_POSITION_MISMATCH/);
  const exit=await persistPaperDailyExit(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z','TRADABLE');assert.equal(exit.kind,'PROTECTIVE_STOP');
  assert.equal(exit.expectedLedgerRevision,ledgers[0].revision);
  const closed=await applyHistoricalDecisionToPaper(db,owner.id,run.id,'EXIT',exit.id,ledgers[0].revision);
  assert.equal(closed.events.length,3);assert.deepEqual(await loadPaperLedger(db,owner.id,run.id),closed);
  assert.equal((await persistPaperProtection(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z')).state,'NO_OPEN_PAPER_POSITION');
  assert.equal((await applyPaperCorporateActions(db,owner.id,run.id,fillDate,closed.revision)).revision,closed.revision);
  await assert.rejects(loadPaperLedger(db,randomUUID(),run.id),/PAPER_LEDGER_NOT_FOUND/);
  await assert.rejects(db.$executeRaw`DELETE FROM "PaperLedgerRevision" WHERE "revision"=${closed.revision}`);
  assert.deepEqual(await db.$queryRaw`SELECT count(*)::text AS count FROM "PortfolioJournal"`,before);
  await assert.rejects(db.$executeRaw`DELETE FROM "HistoricalEntryDecision" WHERE "id"=${results[0].id}`);
 }finally{await db.$disconnect()}
});
test('prior EOD failure exits at the next opening without consuming future daily lows',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),{input,assumptions,signalDate,fillDate}=historicalReplayFixture();
  const afterBuy=[1,2,3].map(offset=>new Date(Date.parse(fillDate)+offset*86400000).toISOString().slice(0,10)),exitDate=afterBuy[2],open=exitDate+'T03:45:00Z';
  for(const date of afterBuy)input.calendar.push({...input.calendar.at(-1),date,opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z'});
  input.through=exitDate;input.knownAt=exitDate+'T11:00:00Z';input.actions[0].coverageThrough=exitDate;
  input.raw.push({...input.raw.at(-1),session:fillDate,open:'100.01',high:'102',low:'96',close:'97',receivedAt:fillDate+'T10:30:00Z',finalizedAt:fillDate+'T10:30:00Z',revisionId:'buy-day',revision:1});
  for(const date of afterBuy.slice(0,2))input.raw.push({...input.raw.at(-1),session:date,open:'98',high:'99',low:'96',close:'97',receivedAt:date+'T10:30:00Z',finalizedAt:date+'T10:30:00Z',revisionId:'observation-'+date,revision:1});
  input.raw.push({...input.raw.at(-1),session:exitDate,open:'96',high:'98',low:'1',close:'50',receivedAt:exitDate+'T10:30:00Z',finalizedAt:exitDate+'T10:30:00Z',revisionId:'future-extrema',revision:1});
  const before=await db.$queryRaw`SELECT count(*)::text AS count FROM "PortfolioJournal"`;
  const stored=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),run=await persistHistoricalReplay(db,owner.id,stored.id,assumptions),events=await readHistoricalReplay(db,owner.id,run.id);
  const source=events.find(event=>event.session===signalDate),signal=source.results[0],attempt=historicalEntryFixture();
  attempt.snapshotId=stored.snapshot.id;attempt.event=signal.breakout.event;attempt.now=signal.earliestFillAt;attempt.earliestFillAt=signal.earliestFillAt;attempt.fees=input.fees;
  attempt.opening={price:'100.01',sourceAt:attempt.now,knownAt:attempt.now,sourceReference:'synthetic-opening'};
  attempt.portfolio=valuePortfolio({cash:'100000',cashVerified:true,reconciled:true,holdings:[],asOf:attempt.now});
  attempt.market.calendar=input.calendar.map(day=>({date:day.date,opensAt:day.opensAt,closesAt:day.closesAt}));
  const initial=await initializePaperLedger(db,owner.id,run.id,'100000'),entry=await persistHistoricalEntry(db,owner.id,run.id,source.id,attempt);
  assert.equal(entry.state,'SIMULATED_FILL');
  const sessionInput={session:fillDate,asOf:fillDate+'T11:00:00Z',sourceReference:'synthetic-session',markets:{[attempt.isin]:{opening:attempt.opening,liquidity:'TRADABLE'}},entries:[{replayEventId:source.id,input:attempt}]};
  const invalid={...sessionInput,entries:[...sessionInput.entries,{replayEventId:source.id,input:{...attempt,event:{...attempt.event,id:'nonexistent-event'}}}]};
  await assert.rejects(runPaperSession(db,owner.id,run.id,invalid),/ENTRY_PIN_MISMATCH/);
  assert.equal((await loadPaperLedger(db,owner.id,run.id)).revision,initial.revision);
  const sessions=await Promise.all([runPaperSession(db,owner.id,run.id,sessionInput),runPaperSession(db,owner.id,run.id,sessionInput)]);
  assert.equal(sessions[0].id,sessions[1].id);
  await assert.rejects(runPaperSession(db,owner.id,run.id,{...sessionInput,sourceReference:'changed'}),/PAPER_SESSION_RETRY_CONFLICT/);
  await assert.rejects(db.$executeRaw`DELETE FROM "PaperSessionResult" WHERE "id"=${sessions[0].id}`);
  const held=await loadPaperLedger(db,owner.id,run.id);
  const daily=await persistPaperDailyExit(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z','TRADABLE');assert.equal(daily.state,'NO_EXIT');
  const firstPlan=await persistPaperProtection(db,owner.id,run.id,attempt.isin,fillDate+'T11:00:00Z');assert.equal(firstPlan.result.failure.state,'OBSERVING');assert.equal(firstPlan.result.failure.observedSessions,0);
  const sessionFor=(date,price)=>({session:date,asOf:date+'T11:00:00Z',sourceReference:'synthetic-session',markets:{[attempt.isin]:{opening:{price,sourceAt:date+'T03:45:00Z',knownAt:date+'T03:45:00Z',sourceReference:'synthetic-opening'},liquidity:'TRADABLE'}},entries:[]});
  await assert.rejects(runPaperSession(db,owner.id,run.id,sessionFor(afterBuy[1],'98')),/PAPER_SESSION_GAP/);
  for(const date of afterBuy.slice(0,2))await runPaperSession(db,owner.id,run.id,sessionFor(date,'98'));
  const plan=await persistPaperProtection(db,owner.id,run.id,attempt.isin,afterBuy[1]+'T11:00:00Z');assert.equal(plan.result.scheduledSell.kind,'SELL_BREAKOUT_FAILURE');assert.equal(Date.parse(plan.effectiveAt),Date.parse(open));
  const opening={price:'96',sourceAt:open,knownAt:open,sourceReference:'synthetic-opening'};
  const decisions=await Promise.all([persistPaperOpeningExit(db,owner.id,run.id,attempt.isin,open,opening,'TRADABLE'),persistPaperOpeningExit(db,owner.id,run.id,attempt.isin,open,opening,'TRADABLE')]);
  const decision=decisions[0];assert.equal(decision.id,decisions[1].id);assert.equal(decision.kind,'PRIOR_EOD_SELL');assert.equal(decision.fill.price,'95.950000');assert.equal(decision.assumptions.scheduledSell.id,plan.id);
  assert.equal(Object.hasOwn(decision.assumptions,'bar'),false);
  await assert.rejects(persistPaperOpeningExit(db,owner.id,run.id,attempt.isin,open,{...opening,price:'90'},'TRADABLE'),/PAPER_OPENING_RETRY_CONFLICT/);
  await assert.rejects(persistPaperOpeningExit(db,randomUUID(),run.id,attempt.isin,open,opening,'TRADABLE'),/PAPER_LEDGER_NOT_FOUND/);
  await assert.rejects(db.$executeRaw`DELETE FROM "PaperOpeningExitDecision" WHERE "id"=${decision.id}`);
  const finalSession=await runPaperSession(db,owner.id,run.id,sessionFor(exitDate,'96'));
  const closed=await loadPaperLedger(db,owner.id,run.id);assert.equal(finalSession.ledgerRevision,closed.revision);
  assert.equal((await applyHistoricalDecisionToPaper(db,owner.id,run.id,'OPENING_EXIT',decision.id,held.revision)).revision,closed.revision);
  const state=readPaperLedger(closed,open,input.calendar);assert.deepEqual(state.portfolio.holdings,{});assert.equal(state.portfolio.cash,readPaperLedger(closed,exitDate+'T11:00:00Z',input.calendar).portfolio.cash);
  const report=await readPaperPerformance(db,owner.id,run.id,input.knownAt);
  assert.equal(report.closedTrades,1);assert.equal(report.losses,1);assert.equal(report.winRate,'0.000000');assert.equal(report.profitFactor,'0.000000');assert.equal(report.signalManualExecutionGap,null);assert.equal(report.netRealizedPnl,state.portfolio.realizedPnl);
  assert.deepEqual(report,await readPaperPerformance(db,owner.id,run.id,input.knownAt));
  const prefix=await readPaperPerformance(db,owner.id,run.id,fillDate+'T11:00:00Z');assert.equal(prefix.closedTrades,0);assert.equal(prefix.openPositions.length,1);assert.equal(prefix.profitFactor,null);
  await assert.rejects(readPaperPerformance(db,randomUUID(),run.id,input.knownAt),/REPLAY_RUN_NOT_FOUND/);
  assert.deepEqual(await db.$queryRaw`SELECT count(*)::text AS count FROM "PortfolioJournal"`,before);
 }finally{await db.$disconnect()}
});
test('stored walk-forward comparisons resolve owned runs and cannot invent training trades',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),base=historicalReplayFixture(),refs=[];
  for(let i=0;i<3;i++){
   const input=structuredClone(base.input),days=input.calendar.slice(i*3,i*3+3);
   input.from=days[0].date;input.through=days.at(-1).date;input.knownAt=input.through+'T11:00:00Z';input.calendar=days;input.raw=input.raw.filter(bar=>bar.session>=input.from&&bar.session<=input.through);
   const snapshot=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input),run=await persistHistoricalReplay(db,owner.id,snapshot.id,base.assumptions.filter(row=>row.session>=input.from&&row.session<=input.through));
   await initializePaperLedger(db,owner.id,run.id,'1000');refs.push({runId:run.id,asOf:input.knownAt});
  }
  const plan=[{id:'fold',candidates:[{id:'baseline',train:refs[0],validation:refs[1],outOfSample:refs[2]}]}];
  const result=await compareStoredWalkForward(db,owner.id,plan);assert.equal(result.folds[0].state,'INSUFFICIENT_TRAINING_EVIDENCE');assert.equal(result.folds[0].selectedCandidateId,null);
  assert.deepEqual(result,await compareStoredWalkForward(db,owner.id,plan));
  await assert.rejects(compareStoredWalkForward(db,randomUUID(),plan),/REPLAY_RUN_NOT_FOUND/);
  const bad=structuredClone(plan);bad[0].candidates[0].train.asOf=base.input.calendar[1].date+'T11:00:00Z';await assert.rejects(compareStoredWalkForward(db,owner.id,bad),/INVALID_WALK_FORWARD_WINDOW/);
 }finally{await db.$disconnect()}
});
test('historical daily events commit atomically, replay retries deduplicate and reconnect restores chronology',async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/vcp_test');
 const db=new PrismaClient();
 try{
  const owner=await db.owner.findFirstOrThrow(),{input,assumptions}=historicalReplayFixture();
  input.through=input.calendar[6].date;input.calendar=input.calendar.slice(0,7);input.raw=input.raw.slice(0,7);
  const stored=await persistHistoricalSnapshot(db,owner.id,randomUUID(),input);
  const runs=await Promise.all([persistHistoricalReplay(db,owner.id,stored.id,assumptions.slice(0,7)),persistHistoricalReplay(db,owner.id,stored.id,assumptions.slice(0,7))]);
  assert.equal(runs[0].id,runs[1].id);assert.equal(runs[0].eventCount,7);
  const rows=await readHistoricalReplay(db,owner.id,runs[0].id);
  assert.equal(rows.length,7);assert.deepEqual(rows.map(row=>row.session),input.calendar.map(row=>row.date));
  assert.ok(rows.every(row=>row.simulated===true&&row.executable===false));
  const bar=input.raw[6],calendar=input.calendar[6],exit={snapshotId:stored.snapshot.id,strategyRevision:stored.snapshot.strategyHash,dataRevision:stored.snapshot.dataRevision,asOf:bar.finalizedAt,position:{id:'synthetic-position',listingId:bar.listingId,quantity:9,entry:'40',initialStop:'35',activeStop:'35',scaleSession:input.calendar[5].date,stopEffectiveAt:calendar.opensAt,partialTaken:false},bar,calendar,actions:input.actions[0],tick:'0.05',lotSize:1,liquidity:'TRADABLE',scheduledSell:null,fees:input.fees,bias:null};
  const exitResults=await Promise.all([persistHistoricalExit(db,owner.id,runs[0].id,exit),persistHistoricalExit(db,owner.id,runs[0].id,exit)]);
  assert.equal(exitResults[0].id,exitResults[1].id);assert.equal(exitResults[0].state,'NO_EXIT');
  await assert.rejects(persistHistoricalExit(db,owner.id,runs[0].id,{...exit,bar:{...bar,low:'1'}}),/EXIT_RAW_PIN_MISMATCH/);
  await assert.rejects(persistHistoricalExit(db,owner.id,runs[0].id,{...exit,liquidity:'UNKNOWN'}),/EXIT_RETRY_CONFLICT/);
  await assert.rejects(persistHistoricalExit(db,randomUUID(),runs[0].id,exit),/REPLAY_RUN_NOT_FOUND/);
  await assert.rejects(db.$executeRaw`DELETE FROM "HistoricalExitDecision" WHERE "id"=${exitResults[0].id}`);
  assert.deepEqual(await readHistoricalReplay(db,randomUUID(),runs[0].id),[]);
  await assert.rejects(db.$executeRaw`DELETE FROM "HistoricalReplayEvent" WHERE "runId"=${runs[0].id}`);
  const restart=new PrismaClient();try{assert.deepEqual(await readHistoricalReplay(restart,owner.id,runs[0].id),rows)}finally{await restart.$disconnect()}
 }finally{await db.$disconnect()}
});
