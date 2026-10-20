import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleState} from '../packages/database/dist/index.js';
test('lifecycle maps unknown data to a block and never promotes it to WATCH or READY',()=>{
 assert.equal(lifecycleState({state:'WATCH_DATA'}),'BLOCKED_DATA');
 for(const state of ['DEVELOPING','WATCH','READY','REJECTED','EXPIRED','INVALIDATED'])assert.equal(lifecycleState({state}),state);
 assert.throws(()=>lifecycleState({state:'UNRECOGNIZED'}),/UNKNOWN_PATTERN_STATE/);
});
