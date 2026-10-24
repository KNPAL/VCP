import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {configurationHash} from '../packages/strategy/dist/index.js';
import {historicalReplayFixture} from '../fixtures/historical-replay.mjs';
import {historicalEntryFixture} from '../fixtures/historical-entry.mjs';
test('golden input bars, dates, configuration, fees, seed and assumptions match the frozen manifest',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../fixtures/historical-golden-manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.replayFixtureHash,configurationHash(historicalReplayFixture()));assert.equal(manifest.entryFixtureHash,configurationHash(historicalEntryFixture()));
 assert.equal(manifest.synthetic,true);assert.equal(manifest.performanceVerified,false);assert.equal(manifest.cases.length,13);assert.equal(new Set(manifest.cases.map(row=>row.id)).size,13);
 for(const file of new Set(manifest.cases.flatMap(row=>[...row.tests,...(row.integration?[row.integration]:[])])))await access(new URL('../'+file,import.meta.url));
});
