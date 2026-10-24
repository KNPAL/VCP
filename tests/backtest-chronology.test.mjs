import test from 'node:test';
import assert from 'node:assert/strict';
import {pinHistoricalSnapshot,replayDailyChronology} from '../packages/backtest/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
test('chronological production detector confirms pivots only at i+3 and breakout only permits a later opening',()=>{
 const {input,assumptions,signalDate,fillDate}=historicalReplayFixture(),snapshot=pinHistoricalSnapshot(input);
 const events=replayDailyChronology(snapshot,assumptions);
 for(let i=270;i<273;i++)assert.ok(!events[i].results[0].structure.structure.swings.some(swing=>swing.index===270));
 assert.ok(events[273].results[0].structure.structure.swings.some(swing=>swing.index===270));
 const signal=events.find(event=>event.session===signalDate);
 assert.equal(signal.results[0].breakout.state,'BREAKOUT_CONFIRMED');
 assert.equal(signal.results[0].earliestFillAt,fillDate+'T03:45:00Z');
 assert.ok(Date.parse(signal.results[0].earliestFillAt)>Date.parse(signal.decidedAt));
 assert.equal(events.at(-1).results[0].state,'UNKNOWN');
 assert.ok(events.every(event=>event.executable===false&&event.performanceVerified===false));
 assert.deepEqual(replayDailyChronology(JSON.parse(JSON.stringify(snapshot)),assumptions).map(e=>e.id),events.map(e=>e.id));
});
test('unknown assumptions are visible; unsupported profiles and early decision times are rejected',()=>{
 const {input}=historicalReplayFixture();input.through=input.from;input.calendar=input.calendar.slice(0,1);
 const snapshot=pinHistoricalSnapshot(input),events=replayDailyChronology(snapshot);
 assert.equal(events[0].assumptions.state,'UNKNOWN');
 assert.throws(()=>replayDailyChronology(snapshot,[{session:input.from,knownAt:input.from+'T00:00:00Z',decidedAt:input.from+'T09:00:00Z',sourceReference:'test',portfolio:{},market:{},quote:{},strength:{}}]),/DECISION_TIME/);
 assert.throws(()=>replayDailyChronology(pinHistoricalSnapshot({...input,strategyConfiguration:{version:'unsupported'}})),/UNSUPPORTED_REPLAY_STRATEGY/);
});
