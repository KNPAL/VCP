import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectorSeries} from '../packages/database/dist/index.js';
import {sma,ema21} from '../packages/indicators/dist/index.js';
import {inspectorFixture} from '../fixtures/inspector.mjs';
test('chart curves use full pinned warmup and leave stored swings and frozen pivots unchanged',()=>{
 const execution=inspectorFixture(),before=structuredClone(execution),rows=inspectorSeries(execution),source=execution.input.series;
 assert.equal(rows.length,260);assert.equal(rows[0].session,source.bars[50].session);
 for(const index of [0,100,259]){const end=index+51,prefix={...source,bars:source.bars.slice(0,end),sessions:source.sessions.slice(0,end)};assert.equal(rows[index].sma50,sma(prefix,50).value);assert.equal(rows[index].sma200,sma(prefix,200).value);assert.equal(rows[index].ema21,ema21(prefix).value)}
 assert.equal(rows[0].sma200,null);assert.equal(rows.at(-1).sma200!==null,true);assert.deepEqual(execution,before);
 const earlier=structuredClone(execution);earlier.input.series.bars=source.bars.slice(0,20);earlier.input.series.sessions=source.sessions.slice(0,20);assert.ok(inspectorSeries(earlier).every(r=>r.ema21===null&&r.sma50===null));
});
