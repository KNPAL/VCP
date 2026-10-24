import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperLedger,appendPaperFill,readPaperLedger,attemptPaperEntry,appendPaperShareAdjustment} from '../packages/backtest/dist/index.js';
import {historicalEntryFixture} from '../fixtures/historical-entry.mjs';
const isin='INE000000001',start='2026-10-20T03:00:00Z';
const fill=(state,id,side,quantity,price,time,fees='0')=>({id,expectedLedgerRevision:state.revision,isin,side,quantity,price,fees,modeledAt:time,decidedAt:time,sourceDecisionId:'decision-'+id,simulated:true,executable:false});

test('a close-observed exit cannot supply cash or reduce exposure at the session opening',()=>{
 let ledger=createPaperLedger('no-lookahead-cash','1000',start);
 ledger=appendPaperFill(ledger,fill(ledger,'buy','BUY',9,'100','2026-10-20T04:00:00Z'));
 const opening='2026-10-21T03:45:00Z',close='2026-10-21T10:30:00Z';
 ledger=appendPaperFill(ledger,{...fill(ledger,'daily-gap','SELL',9,'90',opening),decidedAt:close});
 const before=readPaperLedger(ledger,opening,null).portfolio,after=readPaperLedger(ledger,close,null).portfolio;
 assert.equal(before.cash,'100.000000');assert.equal(before.holdings[isin],9);
 assert.equal(after.cash,'910.000000');assert.deepEqual(after.holdings,{});
 assert.throws(()=>appendPaperFill(ledger,fill(ledger,'retroactive-buy','BUY',1,'100',opening)),/PAPER_DECISIONS_NOT_CHRONOLOGICAL/);
});
test('paper ledger shares exact FIFO fee allocation and preserves immutable snapshots',()=>{
 const initial=createPaperLedger('paper-run','1000',start);
 let ledger=appendPaperFill(initial,fill(initial,'one','BUY',2,'100','2026-10-20T04:00:00Z','2'));
 ledger=appendPaperFill(ledger,fill(ledger,'two','BUY',3,'110','2026-10-20T04:01:00Z','3'));
 const sell=fill(ledger,'three','SELL',4,'120','2026-10-20T04:02:00Z','4');ledger=appendPaperFill(ledger,sell);
 const result=readPaperLedger(ledger,sell.decidedAt,null);
 assert.equal(result.portfolio.cash,'941.000000');assert.equal(result.portfolio.realizedPnl,'52.000000');assert.equal(result.portfolio.positions[0].costBasis,'111.000000');
 assert.equal(initial.events.length,1);assert.equal(result.source,'PAPER');assert.equal(result.executable,false);
 assert.deepEqual(appendPaperFill(ledger,sell),ledger);
 assert.equal(readPaperLedger(ledger,'2026-10-20T04:00:00Z',null).portfolio.holdings[isin],2);
 assert.deepEqual(readPaperLedger(JSON.parse(JSON.stringify(ledger)),sell.decidedAt,null),result);
});
test('paper integrity, changed retries, oversells, cash deficits and stale concurrent revisions are rejected',()=>{
 const state=createPaperLedger('paper-run','100',start),buy=fill(state,'one','BUY',1,'90','2026-10-20T04:00:00Z'),next=appendPaperFill(state,buy);
 assert.throws(()=>appendPaperFill(next,{...buy,price:'91'}),/RETRY_CONFLICT/);
 assert.throws(()=>appendPaperFill(next,{...buy,id:'stale'}),/REVISION_CONFLICT/);
 assert.throws(()=>appendPaperFill(next,fill(next,'oversell','SELL',2,'90','2026-10-20T04:01:00Z')),/SELL_EXCEEDS/);
 assert.throws(()=>appendPaperFill(next,fill(next,'overspend','BUY',1,'90','2026-10-20T04:01:00Z')),/INSUFFICIENT_CASH/);
 const corrupt=JSON.parse(JSON.stringify(next));corrupt.events[1].price='1';assert.throws(()=>readPaperLedger(corrupt,buy.decidedAt,null),/INTEGRITY/);
 assert.throws(()=>appendPaperFill(next,fill(next,'past','SELL',1,'90',start)),/CHRONOLOGICAL/);
});
test('three simulated net losses trigger only the PAPER cooldown',()=>{
 let ledger=createPaperLedger('paper-losses','1000',start);
 for(let i=0;i<3;i++){
  const buyAt=`2026-10-20T04:0${i*2}:00Z`,sellAt=`2026-10-20T04:0${i*2+1}:00Z`;
  ledger=appendPaperFill(ledger,fill(ledger,'buy'+i,'BUY',1,'100',buyAt));ledger=appendPaperFill(ledger,fill(ledger,'sell'+i,'SELL',1,'90',sellAt));
 }
 const calendar=['2026-10-20','2026-10-21'].map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-10-19T00:00:00Z',source:'synthetic',verified:true}));
 const result=readPaperLedger(ledger,'2026-10-20T04:06:00Z',calendar);
 assert.equal(result.cooldown.source,'PAPER');assert.equal(result.cooldown.state,'COOLDOWN');
});
test('paper entry recomputes cash and exposure instead of trusting an oversized portfolio snapshot',()=>{
 const input=historicalEntryFixture(),ledger=createPaperLedger('cash-bound-run','10','2026-01-01T00:00:00Z');
 const result=attemptPaperEntry(ledger,input,null);
 assert.equal(result.decision.state,'BUY_BLOCKED');assert.equal(result.decision.assumptions.portfolio.cash,'10.000000');assert.equal(result.ledger.revision,ledger.revision);
 const funded=createPaperLedger('funded-run','100000','2026-01-01T00:00:00Z'),filled=attemptPaperEntry(funded,input,null);
 assert.equal(filled.decision.state,'SIMULATED_FILL');assert.equal(readPaperLedger(filled.ledger,input.now,null).portfolio.holdings[input.isin],filled.decision.quantity);
 const repeated=attemptPaperEntry(filled.ledger,input,null);assert.equal(repeated.decision.state,'BUY_BLOCKED');assert.equal(repeated.ledger.revision,filled.ledger.revision);
});
test('a three-for-one split preserves exact FIFO costs and cash despite recurring per-share decimals',()=>{
 let ledger=createPaperLedger('split-run','1000',start);
 ledger=appendPaperFill(ledger,fill(ledger,'buy','BUY',1,'100','2026-10-20T04:00:00Z','1'));
 const action={id:'split',isin,sharesAfter:'3',sharesBefore:'1',occurredAt:'2026-10-21T03:45:00Z',recordedAt:'2026-10-21T03:45:00Z',sourceId:'pinned-action'};
 const original=ledger;ledger=appendPaperShareAdjustment(ledger,action,ledger.revision);
 let state=readPaperLedger(ledger,action.recordedAt,null);
 assert.equal(state.portfolio.cash,'899.000000');assert.equal(state.portfolio.holdings[isin],3);assert.equal(state.portfolio.positions[0].costBasis,'101.000000');
 assert.deepEqual(appendPaperShareAdjustment(ledger,action,original.revision),ledger);
 assert.equal(readPaperLedger(ledger,'2026-10-20T05:00:00Z',null).portfolio.holdings[isin],1);
 ledger=appendPaperFill(ledger,fill(ledger,'sell-one','SELL',1,'40','2026-10-21T04:00:00Z'));
 ledger=appendPaperFill(ledger,fill(ledger,'sell-rest','SELL',2,'40','2026-10-21T04:01:00Z'));
 state=readPaperLedger(ledger,'2026-10-21T04:02:00Z',null);
 assert.equal(state.portfolio.cash,'1019.000000');assert.equal(state.portfolio.realizedPnl,'19.000000');assert.deepEqual(state.portfolio.holdings,{});
 assert.equal(state.cooldown.episodes[0].netPnl,'19.000000');assert.equal(state.cooldown.episodes[0].quantity,0);
 assert.throws(()=>appendPaperShareAdjustment(original,{...action,sharesAfter:'3',sharesBefore:'2'},original.revision),/FRACTIONAL_SHARE/);
});
