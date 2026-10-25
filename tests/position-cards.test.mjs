import test from 'node:test';
import assert from 'node:assert/strict';
import {positionCardValues} from '../packages/database/dist/index.js';
test('position cards preserve initial R and exact fee-inclusive FIFO P&L after partial sells',()=>{
 const first=positionCardValues({quantity:3,remainingCost:'303',entry:'100',initialStop:'90',mark:'110'});assert.deepEqual(first,{unrealizedPnl:'27.000000',r0:'10.000000',rMultiple:'1.00000000'});
 const partial=positionCardValues({quantity:2,remainingCost:'202',entry:'100',initialStop:'90',mark:'110'});assert.equal(partial.unrealizedPnl,'18.000000');assert.equal(partial.r0,first.r0);assert.equal(partial.rMultiple,first.rMultiple);
 assert.deepEqual(positionCardValues({quantity:2,remainingCost:'202',entry:'100',initialStop:'90',mark:null}),{unrealizedPnl:null,r0:'10.000000',rMultiple:null});
 assert.equal(positionCardValues({quantity:2,remainingCost:'202',entry:'100',initialStop:'100',mark:'90'}).rMultiple,null);
 assert.equal(positionCardValues({quantity:2,remainingCost:'202',entry:'100',initialStop:'90',mark:'90'}).rMultiple,'-1.00000000');
 assert.equal(positionCardValues({quantity:2,remainingCost:'202',entry:'100',initialStop:null,mark:'110'}).r0,null);
});
