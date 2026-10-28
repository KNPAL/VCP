import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInstrumentMaster,canonicalListings} from '../packages/market-data/dist/index.js';
import {masterFixture} from '../fixtures/instrument-master.mjs';
test('raw master verifies identity and exact tick scale without guessing company identity',()=>{
 const input=masterFixture(),result=normalizeInstrumentMaster(input,input.knownAt);assert.equal(result.status,'VALIDATED');assert.equal(result.rows[0].token,'123');assert.equal(result.rows[0].tick,'0.050000');assert.equal(result.rows[0].lot,1);
 assert.equal(canonicalListings([{id:'test',knownAt:input.knownAt,sourceReference:'synthetic',rows:result.rows}],[input.mappings[0].isin],input.knownAt)[0].status,'KNOWN');
 for(const field of ['symbol','tick_size','lotsize','token']){const copy=structuredClone(input);copy.records[0][field]='wrong';const result=normalizeInstrumentMaster(copy,input.knownAt);assert.equal(result.counts.errors,1);assert.equal(result.rows.length,0)}
 const missing={...input,mappings:[]};assert.equal(normalizeInstrumentMaster(missing,input.knownAt).report[0].reason,'MASTER_MAPPING_MISSING');
});
test('unsupported assets and segments stay excluded, duplicate tokens quarantine all copies',()=>{
 for(const type of ['INDEX','ETF','DERIVATIVE','UNKNOWN']){const input=masterFixture();input.mappings[0].instrumentType=type;assert.equal(normalizeInstrumentMaster(input,input.knownAt).counts.excluded,1)}
 for(const segment of ['NFO','MCX','mystery']){const input=masterFixture();input.records[0].exch_seg=segment;assert.equal(normalizeInstrumentMaster(input,input.knownAt).counts.excluded,1)}
 const duplicate=masterFixture();duplicate.records.push({...duplicate.records[0],token:'123'});const result=normalizeInstrumentMaster(duplicate,duplicate.knownAt);assert.equal(result.rows.length,0);assert.equal(result.counts.errors,2);assert.ok(result.report.every(row=>row.reason==='DUPLICATE_PROVIDER_TOKEN'));
});
test('denied, expired, future, mismatched and unverified sources cannot authorize imports',()=>{
 for(const change of [i=>i.source.uses.STORE=false,i=>i.source.uses.DERIVE=null,i=>i.source.validUntil=i.knownAt,i=>i.source.provider='other',i=>i.knownAt='2027-01-01T00:00:00Z']){const input=masterFixture();change(input);assert.throws(()=>normalizeInstrumentMaster(input,'2026-10-28T06:00:00Z'))}
 const input=masterFixture();input.mappings[0].verified=false;assert.equal(normalizeInstrumentMaster(input,input.knownAt).report[0].reason,'MASTER_MAPPING_UNVERIFIED');
});
