import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateOpeningExit,createPaperLedger,appendPaperFill,readPaperLedger} from '../packages/backtest/dist/index.js';
const now='2026-10-21T03:45:00Z';
const input=()=>({snapshotId:'snapshot',strategyRevision:'strategy',dataRevision:'data',asOf:now,buySession:'2026-10-20',position:{id:'episode',listingId:'listing',quantity:9,entry:'100',initialStop:'90',activeStop:'95',scaleSession:'2026-10-21',stopEffectiveAt:now,partialTaken:false},calendar:{date:'2026-10-21',kind:'TRADING',opensAt:now,closesAt:'2026-10-21T10:00:00Z',finalizedAt:'2026-10-21T10:30:00Z',knownAt:'2026-10-20T00:00:00Z',source:'synthetic',verified:true},opening:{price:'94',sourceAt:now,knownAt:now,sourceReference:'synthetic-open'},tick:'0.05',lotSize:1,liquidity:'TRADABLE',scheduledSell:null,fees:{buyBps:'0',sellBps:'10',slippageBps:'10',minimumFee:'1',sourceReference:'synthetic'},bias:null});
test('opening gaps and prior-EOD sells need no future daily extrema and expose net proceeds at the open',()=>{
 const source=input(),exit=simulateOpeningExit(source);
 assert.equal(exit.kind,'PROTECTIVE_GAP');assert.equal(exit.fill.price,'93.900000');assert.equal(exit.fill.fees,'1.000000');assert.equal(exit.fill.cashAvailableAt,now);
 assert.deepEqual(exit,simulateOpeningExit(source));assert.equal(exit.performanceVerified,false);
 const scheduled={...source,opening:{...source.opening,price:'101'},scheduledSell:{id:'prior-plan',knownAt:'2026-10-20T10:30:00Z',quantity:9}};
 assert.equal(simulateOpeningExit(scheduled).kind,'PRIOR_EOD_SELL');
 assert.equal(simulateOpeningExit({...scheduled,opening:source.opening}).kind,'PROTECTIVE_GAP');
 let ledger=createPaperLedger('run','1000','2026-10-20T03:45:00Z');
 ledger=appendPaperFill(ledger,{id:'buy',expectedLedgerRevision:ledger.revision,isin:'INE000000001',side:'BUY',quantity:9,price:'100',fees:'0',modeledAt:'2026-10-20T03:45:00Z',decidedAt:'2026-10-20T03:45:00Z',sourceDecisionId:'buy',simulated:true,executable:false});
 ledger=appendPaperFill(ledger,{id:exit.id,expectedLedgerRevision:ledger.revision,isin:'INE000000001',side:'SELL',quantity:exit.quantity,price:exit.fill.price,fees:exit.fill.fees,modeledAt:now,decidedAt:now,sourceDecisionId:exit.id,simulated:true,executable:false});
 assert.equal(readPaperLedger(ledger,now,null).portfolio.cash,'944.100000');
});
test('stale, late, unknown-liquidity and same-opening positions never create an opening fill',()=>{
 const source=input();
 for(const changes of [{opening:null},{opening:{...source.opening,knownAt:'2026-10-21T10:30:00Z'}},{opening:{...source.opening,sourceAt:'2026-10-20T03:45:00Z'}},{liquidity:'UNKNOWN'},{liquidity:'PRICE_LIMIT_LOCKED'},{buySession:'2026-10-21'},{position:{...source.position,stopEffectiveAt:'2026-10-21T10:30:00Z'}},{calendar:{...source.calendar,knownAt:'2026-10-22T00:00:00Z'}}]){
  const result=simulateOpeningExit({...source,...changes});assert.equal(result.state,'UNABLE_TO_SIMULATE');assert.equal(result.fill,null);
 }
 assert.equal(simulateOpeningExit({...source,opening:{...source.opening,price:'101'}}).state,'NO_EXIT');
});
