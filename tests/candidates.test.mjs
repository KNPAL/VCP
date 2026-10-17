import test from 'node:test';
import assert from 'node:assert/strict';
import {detect} from '../packages/vcp/dist/index.js';
import {companyCandidate,completeScan,candidatePage} from '../packages/strategy/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
const listingId='00000000-0000-4000-8000-000000000001';
function input(){const series=goldenSeries();return {listingId,patterns:detect(series,{listingId,tick:'0.05',adjustmentRevision:'a1',currentScaleFactor:'1',rs:'85',decidedAt:series.asOf}).patterns,close:series.bars.at(-1).close,rsPercentile:'85',adv20Median:'250000000',dataReasons:[],confirmedMarketEventId:null}}
test('company row retains nested chart evidence and uses the shared primary selector',()=>{
 const source=input(),row=companyCandidate(source);assert.equal(row.marketState,'READY');
 assert.ok(row.patternEvidence.primaryPatternId);assert.equal(row.patternEvidence.patterns.length,source.patterns.length);
 assert.deepEqual(row,companyCandidate({...source,patterns:source.patterns.toReversed()}));
 assert.equal(new Set([row.patternEvidence.primaryPatternId,...row.patternEvidence.nestedPatternIds]).size,source.patterns.length);
 const scan=completeScan({scanId:listingId,asOf:source.patterns[0].asOf,configHash:'a'.repeat(64),dataRevision:'r1'},[listingId],[{instrumentId:listingId,status:'ANALYZED',reasons:[],candidate:row}]);
 const result=candidatePage(scan).items[0];assert.ok(result.patternEvidence.patterns[0].legs[0].high.confirmedAt);assert.ok(result.patternEvidence.patterns[0].atr);assert.equal(result.rank,1);
});
test('missing data, no patterns, company mismatch and market signal remain explicit',()=>{
 const source=input();assert.equal(companyCandidate({...source,dataReasons:['CANDLES_MISSING']}).marketState,'BLOCKED_DATA');
 assert.equal(companyCandidate({...source,patterns:[]}).marketState,'REJECTED');
 assert.equal(companyCandidate({...source,confirmedMarketEventId:'signal'}).marketState,'BUY_MARKET_SIGNAL');
 assert.ok(companyCandidate({...source,rsPercentile:null}).reasons.includes('RS_UNKNOWN'));
 assert.throws(()=>companyCandidate({...source,listingId:'another-company'}),/INVALID_COMPANY/);
});
