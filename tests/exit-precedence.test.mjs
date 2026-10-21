import test from 'node:test';
import assert from 'node:assert/strict';
import {exitPrecedence} from '../packages/portfolio/dist/index.js';
const at='2026-10-21T06:00:00Z',make=(id,kind)=>({id,kind,recognizedAt:at,effectiveAt:'2026-10-22T04:00:00Z',sourceRevision:'revision',resolved:false});
test('exit priority is independent of input order and preserves protective authority',()=>{
 const signals=[make('p','PARTIAL_PROFIT'),make('e','SELL_EMA_CLOSE'),make('f','SELL_BREAKOUT_FAILURE'),{...make('s','SELL_PROTECTIVE'),effectiveAt:at}];
 assert.equal(exitPrecedence(signals,10,at).state,'SELL_PROTECTIVE');assert.deepEqual(exitPrecedence(signals,10,at),exitPrecedence([...signals].reverse(),10,at));
 assert.equal(exitPrecedence(signals.slice(0,3),10,at).state,'SELL_BREAKOUT_FAILURE');assert.equal(exitPrecedence(signals.slice(0,2),10,at).state,'SELL_EMA_CLOSE');assert.equal(exitPrecedence(signals.slice(0,1),10,at).state,'PARTIAL_PROFIT');
 assert.equal(exitPrecedence(signals,0,at).state,'CLOSED_WITHOUT_SIGNAL_EXECUTION');assert.equal(exitPrecedence(signals.map(s=>({...s,resolved:true})),10,at).primary,null);
});
test('recognition and effective boundaries are distinct; no missing signal implies HOLD',()=>{
 const signal=make('e','SELL_EMA_CLOSE');assert.equal(exitPrecedence([signal],10,'2026-10-21T05:59:59Z').state,'NO_EXIT_SIGNAL');
 assert.equal(exitPrecedence([signal],10,at).effective,false);assert.equal(exitPrecedence([signal],10,signal.effectiveAt).effective,true);assert.equal(exitPrecedence([],10,at).state,'NO_EXIT_SIGNAL');
});
