import test from 'node:test';
import assert from 'node:assert/strict';
import {pinHistoricalSnapshot,historicalSlice,replayDailyChronology,createPaperLedger,attemptPaperEntry,readPaperLedger} from '../packages/backtest/dist/index.js';
import {readiness,GATES} from '../packages/market-data/dist/index.js';
import {valuePortfolio} from '../packages/portfolio/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
import {historicalEntryFixture} from '../fixtures/historical-entry.mjs';

test('validation warm-up supplies earlier indicators without emitting earlier signals or fills',()=>{
 const {input,assumptions,signalDate}=historicalReplayFixture();input.historyFrom=input.from;input.from=input.raw.at(-2).session;
 const snapshot=pinHistoricalSnapshot(input),events=replayDailyChronology(snapshot,assumptions);
 assert.equal(events.length,3);assert.ok(events.every(event=>event.session>=input.from));assert.equal(events.find(event=>event.session===signalDate).results[0].breakout.state,'BREAKOUT_CONFIRMED');
 assert.ok(historicalSlice(snapshot,signalDate+'T11:00:00Z').selected[0].adjustment.bars.length>300);
 assert.throws(()=>pinHistoricalSnapshot({...input,historyFrom:input.through}),/INVALID_WARMUP_RANGE/);
});

test('IPO history cannot be invented from pre-listing raw rows, and SME mappings cannot produce a cash-equity signal',()=>{
 const {input,assumptions,signalDate}=historicalReplayFixture(),listingDate=input.raw.at(-30).session;
 input.instruments[0].rows[0].listingDate=listingDate;input.instruments[0].rows[0].validFrom=listingDate;
 const snapshot=pinHistoricalSnapshot(input),slice=historicalSlice(snapshot,signalDate+'T11:00:00Z');
 assert.equal(slice.selected[0].adjustment.bars.length,30);assert.equal(slice.selected[0].adjustment.bars[0].session,listingDate);
 const short=pinHistoricalSnapshot({...input,from:listingDate});
 assert.ok(replayDailyChronology(short,assumptions.filter(row=>row.session>=listingDate)).every(day=>day.results.every(row=>!row.breakout?.event)));
 input.instruments[0].rows[0].series='SM';
 const sme=historicalSlice(pinHistoricalSnapshot(input),signalDate+'T11:00:00Z');assert.equal(sme.selected[0].listingId,null);assert.ok(sme.reasons.some(reason=>reason.startsWith('NO_VERIFIED_CASH_EQUITY_LISTING')));
});
test('all G01-G10 gates independently block BUY when failed, missing or expired',()=>{
 const now='2026-10-20T04:00:00Z',proofs=Object.keys(GATES).map(gate=>({id:'synthetic-'+gate,gate,status:'PASS',probeAt:now,sourceAt:now,expiresAt:'2026-10-20T05:00:00Z',sourceReference:'synthetic-only',reason:null,details:{fixture:true}}));
 assert.equal(readiness(proofs,now).buyAllowed,true);
 for(const gate of Object.keys(GATES)){
  assert.equal(readiness(proofs.filter(proof=>proof.gate!==gate),now).buyAllowed,false);
  for(const status of ['FAIL','UNKNOWN'])assert.equal(readiness(proofs.map(proof=>proof.gate===gate?{...proof,status}:proof),now).buyAllowed,false);
  assert.equal(readiness(proofs.map(proof=>proof.gate===gate?{...proof,expiresAt:now}:proof),now).buyAllowed,false);
 }
});
test('competing opening entries share ledger cash and stop at five companies',()=>{
 const base=historicalEntryFixture();let ledger=createPaperLedger('five-companies','100000','2024-01-01T00:00:00Z');
 const fills=[];
 for(let i=0;i<6;i++){
  const state=readPaperLedger(ledger,base.now,null),isin='INE'+String(i+1).padStart(9,'0'),sector='SECTOR-'+i;
  const holdings=Object.entries(state.portfolio.holdings).map(([held,quantity])=>({isin:held,quantity,sector:'SECTOR-'+(Number(held.slice(3))-1),price:'101.15',quoteAt:base.now,verified:true,stop:'93.95'}));
  const input={...structuredClone(base),isin,sector,event:{...base.event,id:'signal-'+i,listingId:'listing-'+i},portfolio:valuePortfolio({cash:state.portfolio.cash,cashVerified:true,reconciled:true,holdings,asOf:base.now})};
  const result=attemptPaperEntry(ledger,input,null);fills.push(result.decision);ledger=result.ledger;
 }
 assert.ok(fills.slice(0,5).every(fill=>fill.state==='SIMULATED_FILL'));
 assert.equal(fills[5].state,'BUY_BLOCKED');assert.ok(fills[5].reasons.includes('POSITION_CAP'));
 assert.equal(Object.keys(readPaperLedger(ledger,base.now,null).portfolio.holdings).length,5);
});
