import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateOpeningEntry} from '../packages/backtest/dist/index.js';
import {valuePortfolio} from '../packages/portfolio/dist/index.js';
import {historicalEntryFixture} from '../fixtures/historical-entry.mjs';
import {parseFixed} from '../packages/domain/dist/index.js';
import {canonicalConfiguration} from '../packages/strategy/dist/index.js';
test('next opening applies conservative slippage, tick rounding, fees and shared position sizing',()=>{
 const input=historicalEntryFixture(),result=simulateOpeningEntry(input);
 assert.equal(result.state,'SIMULATED_FILL');assert.equal(result.price,'101.150000');assert.ok(result.quantity>0);
 assert.equal(result.stop,'93.950000');assert.equal(result.executable,false);
 assert.ok(parseFixed(result.price)*BigInt(result.quantity)+parseFixed(result.fees)<=parseFixed(input.portfolio.cash));
 for(const cap of Object.values(result.sizing.caps))assert.ok(BigInt(result.quantity)<=BigInt(cap));
 assert.deepEqual(result,simulateOpeningEntry(structuredClone(input)));
 assert.deepEqual(result,simulateOpeningEntry(JSON.parse(canonicalConfiguration(input))));
});
test('chase gap, wide stop, missing cash, sixth position and unknown risk gates never fabricate fills',()=>{
 for(const change of [x=>x.opening.price='103',x=>x.event.lastLow='90',x=>x.lossStreakPass=false,x=>x.sector=null,x=>x.market.gates.G04='UNKNOWN',x=>x.portfolio=valuePortfolio({cash:'0',cashVerified:true,reconciled:true,holdings:[],asOf:x.now}),x=>x.portfolio=valuePortfolio({cash:'100000',cashVerified:true,reconciled:true,asOf:x.now,holdings:Array.from({length:5},(_,i)=>({isin:'INE00000000'+(i+2),sector:'OTHER',quantity:1,price:'100',quoteAt:x.now,verified:true,stop:'95'}))})]){
  const input=historicalEntryFixture();change(input);const result=simulateOpeningEntry(input);
  assert.notEqual(result.state,'SIMULATED_FILL');assert.equal(result.quantity,0);assert.equal(result.fees,null);
 }
 const missed=historicalEntryFixture();missed.opening.price='103';assert.equal(simulateOpeningEntry(missed).state,'MISSED');
 const held=historicalEntryFixture();held.portfolio=valuePortfolio({cash:'100000',cashVerified:true,reconciled:true,asOf:held.now,holdings:[{isin:held.isin,sector:held.sector,quantity:1,price:'101',quoteAt:held.now,verified:true,stop:'94'}]});
 assert.ok(simulateOpeningEntry(held).reasons.includes('AUTOMATIC_ADD_PROHIBITED'));assert.equal(simulateOpeningEntry(held).quantity,0);
});
test('close-day, second-session, future-opening knowledge and stale portfolio are blocked',()=>{
 for(const change of [x=>x.earliestFillAt=x.event.decidedAt,x=>x.now=x.market.calendar[52].opensAt,x=>x.opening.knownAt='2099-01-01T00:00:00Z',x=>x.portfolio.asOf=x.event.decidedAt,x=>x.opening=null]){
  const input=historicalEntryFixture();change(input);assert.equal(simulateOpeningEntry(input).quantity,0);
 }
});
