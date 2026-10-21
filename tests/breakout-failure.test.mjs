import test from 'node:test';
import assert from 'node:assert/strict';
import {breakoutFailure} from '../packages/portfolio/dist/index.js';
const day=i=>'2026-10-'+String(10+i).padStart(2,'0');
const input=closes=>({buySession:day(0),pivot:'100',scaleVerified:true,asOf:'2026-10-16T11:00:00.000Z',sessions:closes.map((close,i)=>({date:day(i),close,closedAt:day(i)+'T10:00:00.000Z',finalizedAt:day(i)+'T10:05:00.000Z'})),nextSessions:Array.from({length:8},(_,i)=>({date:day(i),opensAt:day(i)+'T03:45:00.000Z'}))});
test('only two consecutive closes in first five sessions after BUY trigger failure',()=>{
 assert.equal(breakoutFailure(input(['99','99'])).state,'OBSERVING');
 const result=breakoutFailure(input(['101','99','99']));assert.equal(result.state,'SELL_BREAKOUT_FAILURE');assert.equal(result.triggerSession,day(2));assert.equal(result.effectiveAt,'2026-10-16T11:00:00.000Z');
 assert.equal(breakoutFailure(input(['101','99','100','99','101','99','99'])).state,'WINDOW_COMPLETE');
 assert.equal(breakoutFailure(input(['101','101','101','101','99','99'])).triggerSession,day(5));
});
test('failure is next-session effective, unknown sources cannot fabricate a signal',()=>{
 const base=input(['101','99','99']);base.asOf=day(2)+'T11:00:00.000Z';
 assert.equal(breakoutFailure(base).effectiveAt,day(3)+'T03:45:00.000Z');
 for(const patch of [{pivot:null},{scaleVerified:false},{nextSessions:[]},{sessions:[...base.sessions,{date:day(3),close:null,closedAt:day(3)+'T10:00:00.000Z',finalizedAt:day(3)+'T10:05:00.000Z'}]}])assert.equal(breakoutFailure({...base,...patch}).state,'UNKNOWN');
 assert.deepEqual(breakoutFailure(base),breakoutFailure(base));assert.equal(breakoutFailure(base).executable,false);
});
