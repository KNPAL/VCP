import test from 'node:test';
import assert from 'node:assert/strict';
import {smeResearch,validateSmeResearch} from '../packages/market-data/dist/index.js';
import {smeEvidence} from '../fixtures/sme-research.mjs';
const source=smeEvidence(),input={asOf:source.knownAt,liquidity:'100000.000000',liquiditySourceAt:source.knownAt,actionRevision:'actions',actionSourceAt:source.knownAt};
test('complete SME research is still blocked from BUY and guaranteed OHLC fills',()=>{
 const result=smeResearch(source,input);assert.equal(result.state,'RESEARCH_OBSERVATION');assert.equal(result.lot,100);assert.equal(result.buyEligible,false);assert.equal(result.executable,false);assert.equal(result.guaranteedFill,false);assert.equal(result.buyState,'BUY_BLOCKED');
 assert.equal(smeResearch({...source,lot:null,lotVerified:false},input).lot,null);assert.equal(smeResearch({...source,lot:null,lotVerified:false},input).state,'UNKNOWN');
 assert.equal(smeResearch(source,{...input,liquidity:'0'}).state,'RESTRICTED');assert.equal(smeResearch(source,{...input,liquidity:null}).state,'UNKNOWN');assert.equal(smeResearch(source,{...input,actionRevision:null}).state,'UNKNOWN');assert.equal(smeResearch({...source,thinExecutionAssumptions:[]},input).state,'UNKNOWN');
});
test('restricted, expired and unpermitted sources never become a clear SME observation',()=>{
 assert.equal(smeResearch({...source,restrictions:{...source.restrictions,asm:true}},input).state,'RESTRICTED');assert.equal(smeResearch({...source,restrictions:{...source.restrictions,cashTradable:null}},input).state,'UNKNOWN');
 for(const evidence of [{...source,source:{...source.source,uses:{...source.source.uses,DISPLAY:false}}},{...source,source:{...source.source,licenseRef:null}}]){const result=smeResearch(evidence,input);assert.equal(result.state,'UNKNOWN');assert.equal(result.lot,null);assert.equal(result.liquidity,null);assert.equal(result.restrictions,null)}
 const staleRestriction=smeResearch({...source,restrictions:{...source.restrictions,asm:true,validUntil:input.asOf}},input);assert.equal(staleRestriction.state,'UNKNOWN');assert.equal(staleRestriction.restrictions,null);assert.equal(smeResearch(source,{...input,asOf:source.source.validUntil}).lot,null);assert.equal(smeResearch({...source,segmentVerified:false},input).state,'UNKNOWN');assert.equal(smeResearch(null,input).state,'UNKNOWN');
 assert.throws(()=>validateSmeResearch({...source,lot:0}),/INVALID_SME_RESEARCH/);assert.throws(()=>validateSmeResearch({...source,restrictions:{...source.restrictions,asm:undefined}}),/INVALID_SME_RESEARCH/);
});

test('future or invalid liquidity is unknown rather than an observed restriction',()=>{
 for(const change of [{liquidity:'0',liquiditySourceAt:source.source.validUntil},{liquidity:'-1'},{liquidity:'0',liquiditySourceAt:null}]){const result=smeResearch(source,{...input,...change});assert.equal(result.state,'UNKNOWN');assert.equal(result.liquidity,null);assert.equal(result.liquiditySourceAt,null);assert.equal(result.buyEligible,false)}
});
