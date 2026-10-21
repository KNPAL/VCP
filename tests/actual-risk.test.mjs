import test from 'node:test';
import assert from 'node:assert/strict';
import {actualRisk,remainingWeightedEntry,valuePortfolio,sizeTopUp} from '../packages/portfolio/dist/index.js';
const at='2026-10-21T06:00:00Z',isin='INE000000001';
test('weighted entry uses remaining FIFO quantities and remaining allocated fees',()=>{
 const lots=[{isin,remainingQty:0,price:'50',remainingFees:'0'},{isin,remainingQty:2,price:'100',remainingFees:'1'},{isin,remainingQty:3,price:'110',remainingFees:'2'}];
 assert.deepEqual(remainingWeightedEntry(lots,isin),{quantity:5,weightedEntry:'106.000000',costPerShareAfterFees:'106.600000',remainingCost:'533.000000'});
 assert.equal(remainingWeightedEntry(lots,'INE000000002'),null);
});
test('known actual breaches remain visible even while other evidence is unknown',()=>{
 const p=valuePortfolio({cash:'-1',cashVerified:true,reconciled:false,holdings:[{isin,sector:null,quantity:10,price:null,quoteAt:null,verified:false,stop:null}],asOf:at});
 const result=actualRisk(p,'UNKNOWN');assert.equal(result.state,'BREACH_ACTUAL');assert.ok(result.breaches.includes('CASH'));assert.ok(result.unknown.includes('GROSS_CAP'));assert.equal(result.executable,false);
 const known=valuePortfolio({cash:'850',cashVerified:true,reconciled:true,holdings:[{isin,sector:'TECH',quantity:1,price:'150',quoteAt:at,verified:true,stop:'140'}],asOf:at});
 assert.equal(actualRisk(known,'GREEN').state,'WITHIN_OBSERVED_CAPS');assert.ok(actualRisk({...known,companyExposure:{[isin]:'150.000001'}},'GREEN').breaches.includes('STOCK_CAP:'+isin));
});
test('manual top-up proposals validate remaining FIFO entry, fees, caps and market lots',()=>{
 const p=valuePortfolio({cash:'99000',cashVerified:true,reconciled:true,holdings:[{isin,sector:'TECH',quantity:10,price:'100',quoteAt:at,verified:true,stop:'95'}],asOf:at});
 const input={portfolio:p,isin,sector:'TECH',entry:'100',stop:'95',regime:'GREEN',lotSize:1,estimatedFees:'10',lossStreakPass:true,lots:[{isin,remainingQty:10,price:'100',remainingFees:'2'}],requestedQuantity:5};
 const result=sizeTopUp(input);assert.equal(result.state,'BUY_ELIGIBLE');assert.equal(result.weightedEntry,'100.000000');assert.equal(result.costPerShareAfterFees,'100.800000');assert.equal(result.automatedAdd,false);assert.equal(result.riskBudget,'399.960000');
 assert.equal(sizeTopUp({...input,requestedQuantity:10000}).state,'BUY_BLOCKED');assert.ok(sizeTopUp({...input,lotSize:3}).reasons.includes('MARKET_LOT'));
 assert.ok(sizeTopUp({...input,lots:[]}).reasons.includes('OPEN_FIFO_POSITION_REQUIRED'));
 assert.ok(sizeTopUp({...input,stop:'90'}).reasons.includes('STOP_WIDER_THAN_8_PERCENT'));
});
