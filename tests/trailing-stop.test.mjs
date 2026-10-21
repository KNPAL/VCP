import test from 'node:test';
import assert from 'node:assert/strict';
import {trailingStop} from '../packages/portfolio/dist/index.js';
const base={entry:'100',initialStop:'95',activeStop:'95',tick:'0.05',close:'105',ema21:'103.12999999',atr14:'2.01',activated:false,scaleVerified:true,session:'2026-10-20',closedAt:'2026-10-20T10:00:00.000Z',finalizedAt:'2026-10-20T10:05:00.000Z',asOf:'2026-10-20T11:00:00.000Z',nextSession:{date:'2026-10-21',opensAt:'2026-10-21T03:45:00.000Z'},sourceRevision:'revision'};
test('trail activates exactly at completed 1R and floors the candidate to a tick',()=>{
 assert.equal(trailingStop({...base,close:'104.999999'}).state,'WAITING_1R');
 const result=trailingStop(base);assert.equal(result.state,'TRAIL_UPDATE');assert.equal(result.nextStop,'102.100000');assert.equal(result.effectiveAt,base.nextSession.opensAt);assert.equal(result.executable,false);
 assert.equal(trailingStop({...base,activeStop:'104'}).nextStop,'104.000000');
 assert.equal(trailingStop({...base,activated:true,close:'104'}).activated,true);
});
test('EMA close signal keeps old protection and EMA weakness alone is informational',()=>{
 const sell=trailingStop({...base,ema21:'107',atr14:'4'});assert.equal(sell.state,'SELL_EMA_CLOSE');assert.equal(sell.nextStop,'95');
 const weakness=trailingStop({...base,ema21:'106',atr14:'4'});assert.equal(weakness.state,'TRAIL_UPDATE');assert.ok(weakness.reasons.includes('EMA_WEAKNESS'));
});
test('missing or unfinalized inputs cannot change protection or backdate a stop',()=>{
 for(const patch of [{nextSession:null},{ema21:null},{atr14:null},{scaleVerified:false},{finalizedAt:'2026-10-20T12:00:00.000Z'},{sourceRevision:''}]){
  const r=trailingStop({...base,...patch});assert.equal(r.state,'UNKNOWN');assert.equal(r.nextStop,null);
 }
 const late=trailingStop({...base,asOf:'2026-10-21T05:00:00.000Z'});assert.equal(late.effectiveAt,'2026-10-21T05:00:00.000Z');
 assert.deepEqual(trailingStop(base),trailingStop(base));
});
