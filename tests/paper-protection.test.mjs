import test from 'node:test';
import assert from 'node:assert/strict';
import {pinHistoricalSnapshot,paperEodProtection} from '../packages/backtest/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
test('paper EOD protection uses shared indicators and schedules failure before trailing at the next opening',()=>{
 const {input,signalDate,fillDate}=historicalReplayFixture(),snapshot=pinHistoricalSnapshot(input);
 const position={id:'paper-position',listingId:input.raw[0].listingId,quantity:9,entry:'80',initialStop:'70',activeStop:'70',scaleSession:signalDate,stopEffectiveAt:signalDate+'T03:45:00Z',partialTaken:false,buySession:input.raw[308].session,pivot:'110',trailActivated:false};
 const result=paperEodProtection(snapshot,position,signalDate+'T10:30:00Z');
 assert.equal(result.state,'EVALUATED');assert.equal(result.trail.activated,true);assert.equal(result.trail.effectiveAt,fillDate+'T03:45:00.000Z');
 assert.equal(result.failure.state,'SELL_BREAKOUT_FAILURE');assert.equal(result.scheduledSell.kind,'SELL_BREAKOUT_FAILURE');
 assert.deepEqual(result,paperEodProtection(snapshot,position,signalDate+'T10:30:00Z'));assert.equal(position.activeStop,'70');
 assert.equal(paperEodProtection(snapshot,{...position,scaleSession:'2020-01-01'},signalDate+'T10:30:00Z').state,'UNKNOWN');
});
