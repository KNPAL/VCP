import test from 'node:test';
import assert from 'node:assert/strict';
import {positionStatus} from '../packages/portfolio/dist/index.js';
const complete={quantity:10,partiallySold:false,primary:null,health:'FEED_FRESH',protective:'CLEAR',trailing:'CLEAR',failure:'CLEAR',partial:'CLEAR',reasons:[]};
test('HOLD requires complete applicable inputs, independently of actual lifecycle',()=>{
 assert.equal(positionStatus(complete).action,'HOLD');
 for(const rule of ['protective','trailing','failure','partial']){const result=positionStatus({...complete,[rule]:'UNKNOWN'});assert.equal(result.action,'UNABLE_TO_EVALUATE');assert.equal(result.lifecycle,'OPEN')}
 for(const health of ['MONITOR_DEGRADED','MARKET_CLOSED'])assert.equal(positionStatus({...complete,health}).action,'UNABLE_TO_EVALUATE');
 assert.equal(positionStatus({...complete,trailing:'NOT_APPLICABLE',failure:'NOT_APPLICABLE',partial:'RESOLVED'}).action,'HOLD');
});
test('alerts do not execute fills and feed drops cannot erase a protective recommendation',()=>{
 const alert=positionStatus({...complete,primary:'SELL_PROTECTIVE',health:'MONITOR_DEGRADED',protective:'UNKNOWN'});
 assert.equal(alert.lifecycle,'EXIT_ALERTED');assert.equal(alert.actualFillState,'OPEN');assert.equal(alert.quantity,10);assert.equal(alert.action,'SELL_PROTECTIVE');assert.equal(alert.health,'MONITOR_DEGRADED');
 assert.equal(positionStatus({...complete,quantity:7,partiallySold:true}).lifecycle,'PARTIALLY_EXITED');
 assert.equal(positionStatus({...complete,primary:'PARTIAL_PROFIT'}).lifecycle,'OPEN');
 const closed=positionStatus({...complete,quantity:0,primary:'SELL_PROTECTIVE'});assert.equal(closed.lifecycle,'CLOSED');assert.equal(closed.action,'CLOSED');assert.equal(closed.executable,false);
 assert.deepEqual(positionStatus(complete),positionStatus(complete));
});
