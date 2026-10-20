import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfileVersion} from '../packages/database/dist/index.js';
import {ST_VCP_4_0,PROFILE_VERSION} from '../packages/strategy/dist/index.js';
test('settings validates exact default and new draft identity without granting execution authority',()=>{
 assert.equal(validateProfileVersion(PROFILE_VERSION,ST_VCP_4_0).version,PROFILE_VERSION);
 const version='ST_VCP_RESEARCH_1',configuration={...ST_VCP_4_0,version,baselineRisk:'0.003'};
 assert.equal(validateProfileVersion(version,configuration).configuration.baselineRisk,'0.003');
 assert.throws(()=>validateProfileVersion(version,{...configuration,automaticOrders:true}),/AUTHORITY/);
 assert.throws(()=>validateProfileVersion(version,{...configuration,automaticAddSignal:true}),/AUTHORITY/);
 assert.throws(()=>validateProfileVersion(PROFILE_VERSION,{...ST_VCP_4_0,maximumStop:'0.09'}),/IMMUTABLE/);
 assert.throws(()=>validateProfileVersion(version,ST_VCP_4_0),/MISMATCH/);
});
test('settings rejects unknown keys, secret-like fields, malformed numbers and missing configuration',()=>{
 const version='ST_VCP_RESEARCH_2',configuration={...ST_VCP_4_0,version};
 for(const invalid of [{...configuration,apiKey:'never-store'},{...configuration,maximumPositions:1.5},{...configuration,maximumVdu:'NaN'},{...configuration,maximumVdu:null},{...configuration,algorithm:'NEW_ENGINE'},{}])assert.throws(()=>validateProfileVersion(version,invalid));
 assert.throws(()=>validateProfileVersion('arbitrary',configuration));
});
