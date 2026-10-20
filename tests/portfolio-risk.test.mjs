import test from 'node:test';
import assert from 'node:assert/strict';
import {valuePortfolio,sizeEntry} from '../packages/portfolio/dist/index.js';
const asOf='2026-10-16T06:00:00Z',isin='INE000000001';
const portfolio=(holdings=[],cash='100000')=>valuePortfolio({holdings,cash,cashVerified:true,reconciled:true,asOf});
const mark=(overrides={})=>({isin,sector:'TECH',quantity:100,price:'100',quoteAt:asOf,verified:true,stop:'95',...overrides});
const plan=(overrides={})=>sizeEntry({portfolio:portfolio(),isin,sector:'TECH',entry:'100',stop:'95',regime:'GREEN',lotSize:1,estimatedFees:'0',lossStreakPass:true,...overrides});
test('cash, equity and exposures aggregate same-company holdings across exchanges',()=>{
 const p=portfolio([mark(),mark({quantity:50})]);assert.equal(p.cash,'100000.000000');assert.equal(p.equity,'115000.000000');
 assert.equal(p.positionCount,1);assert.equal(p.companyExposure[isin],'15000.000000');assert.equal(p.sectorExposure.TECH,'15000.000000');assert.equal(p.plannedOpenRisk,'750.000000');
});
test('unknown marks, reconciliation and missing stops block plans without erasing holdings',()=>{
 for(const change of [{price:null},{quoteAt:'2026-10-16T05:58:59Z'},{quoteAt:'2026-10-16T06:00:01Z'},{verified:false},{stop:null},{sector:null}]){
  const p=portfolio([mark(change)]);assert.equal(p.state,'UNKNOWN');assert.equal(p.positions[0].quantity,100);assert.equal(plan({portfolio:p}).state,'BUY_BLOCKED');
 }
 assert.equal(valuePortfolio({holdings:[],cash:'100',cashVerified:true,reconciled:false,asOf}).state,'UNKNOWN');
});
test('stale or unverified marks never masquerade as current numeric exposure',()=>{
 for(const change of [{verified:false},{quoteAt:'2026-10-16T05:59:00Z'},{quoteAt:'2026-10-16T06:00:01Z'},{price:null}]){
  const p=portfolio([mark(),mark(change)]);
  assert.equal(p.equity,null);assert.equal(p.grossExposure,null);assert.equal(p.plannedOpenRisk,null);
  assert.equal(p.companyExposure[isin],null);assert.equal(p.sectorExposure.TECH,null);assert.equal(p.positions[1].value,null);assert.equal(p.positionCount,1);
 }
 const noCash=valuePortfolio({holdings:[mark()],cash:'100000',cashVerified:false,reconciled:true,asOf});
 assert.equal(noCash.cash,null);assert.equal(noCash.equity,null);assert.equal(noCash.grossExposure,'10000.000000');
 assert.equal(portfolio([mark({quoteAt:'2026-10-16T05:59:00.001Z'})]).state,'KNOWN');
});
test('risk budget, regime multiplier, hard stops and market lots use exact downward rounding',()=>{
 assert.equal(plan().riskBudget,'400.000000');assert.equal(plan().quantity,80);
 assert.equal(plan({regime:'YELLOW'}).quantity,40);assert.equal(plan({regime:'RED'}).quantity,0);
 assert.equal(plan({lotSize:30}).quantity,60);assert.equal(plan({stop:'92'}).quantity,50);
 assert.ok(plan({stop:'91.999999'}).reasons.includes('STOP_WIDER_THAN_8_PERCENT'));
 assert.equal(plan({lossStreakPass:null}).quantity,0);
});
test('all concentration, cash and open-risk caps limit final shares',()=>{
 const p=portfolio([mark({quantity:140,stop:'99'})],'86000');
 const result=plan({portfolio:p,stop:'99'});assert.equal(result.caps.stock,'10');assert.equal(result.quantity,10);
 const debt=portfolio([],'1');assert.equal(plan({portfolio:debt,estimatedFees:'2'}).quantity,0);
 const heavy=portfolio([mark({quantity:400,stop:'90'})],'60000');assert.equal(plan({portfolio:heavy}).caps.openRisk,'0');
 const five=portfolio(Array.from({length:5},(_,i)=>mark({isin:'INE00000000'+(i+1),quantity:1})),'99500');
 assert.ok(plan({portfolio:five,isin:'INE000000009'}).reasons.includes('POSITION_CAP'));
 assert.equal(plan({portfolio:five}).reasons.includes('POSITION_CAP'),false);
 assert.deepEqual(plan(),plan());
});
