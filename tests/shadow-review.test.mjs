import test from 'node:test';
import assert from 'node:assert/strict';
import {shadowReview} from '../packages/strategy/dist/index.js';
import {valuePortfolio,sizeEntry} from '../packages/portfolio/dist/index.js';
const at='2026-10-18T10:00:00.000Z';
const input=()=>({mode:'SHADOW',at,strategyVersion:'ST_VCP_4_0',modelVersion:'offline-1',promptVersion:'prompt-1',evidence:['VCP','RS','VOLUME','PIVOT','PORTFOLIO_RISK','SOURCE_QUALITY'].map(kind=>({kind,revision:'revision-1',at,quality:'VERIFIED'})),response:{version:'response-1',at,outcome:'PASS'}});
test('shadow outcomes never expose trading authority or mutate deterministic evidence',()=>{
 for(const mode of ['SHADOW','ADVISORY'])for(const outcome of ['PASS','VETO','REVIEW_REQUIRED','UNAVAILABLE']){
  const source={...input(),mode,response:{version:'response-1',at,outcome}};
  const before=structuredClone(source),result=shadowReview(source);
  assert.equal(result.outcome,outcome);assert.equal(result.authoritative,false);assert.deepEqual(source,before);
  assert.equal('buyEligible' in result,false);assert.equal('sell' in result,false);
  result.evidence[0].revision='changed';assert.equal(source.evidence[0].revision,'revision-1');
 }
});
test('AI disabled and missing or invalid responses explicitly remain unavailable',()=>{
 assert.equal(shadowReview({...input(),mode:'DISABLED'}).reason,'AI_DISABLED');
 for(const response of [null,undefined,'PASS',{}, {version:'r1',at,outcome:'APPROVE'}, {version:'r1',at,outcome:'PASS',pivot:'1'}, {version:'r1',at:'2027-01-01T00:00:00.000Z',outcome:'PASS'}]){
  const result=shadowReview({...input(),response});assert.equal(result.outcome,'UNAVAILABLE');assert.equal(result.evidence.length,6);assert.equal(result.promptVersion,'prompt-1');
 }
});
test('missing, unknown, duplicate or future source evidence cannot imply approval',()=>{
 const source=input();
 for(const evidence of [source.evidence.slice(1),[...source.evidence,source.evidence[0]],source.evidence.map(e=>({...e,quality:'UNKNOWN'})),source.evidence.map(e=>({...e,at:'2027-01-01T00:00:00.000Z'}))])assert.equal(shadowReview({...source,evidence}).reason,'EVIDENCE_UNAVAILABLE');
 assert.throws(()=>shadowReview({...source,evidence:[{...source.evidence[0],at:'invalid'}]}),/INVALID_SHADOW_EVIDENCE/);
});
test('AI PASS cannot clear an unreconciled portfolio BUY gate',()=>{
 const portfolio=valuePortfolio({cash:'100000',cashVerified:true,reconciled:false,holdings:[],asOf:at});
 const request={portfolio,isin:'INE002A01018',sector:'ENERGY',entry:'100',stop:'95',regime:'GREEN',lotSize:1,estimatedFees:'0',lossStreakPass:true};
 const before=sizeEntry(request);
 assert.equal(shadowReview(input()).outcome,'PASS');
 assert.deepEqual(sizeEntry(request),before);
 assert.equal(before.state,'BUY_BLOCKED');assert.ok(before.reasons.includes('PORTFOLIO_UNRECONCILED'));
});
