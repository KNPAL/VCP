import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeEntryPlan,sameEntryQuote} from '../packages/database/dist/entry-authorization.js';
import {valuePortfolio,sizeEntry,entrySizingGates} from '../packages/portfolio/dist/index.js';
import {evaluateEntry,structuralStop} from '../packages/strategy/dist/index.js';
import {entryInput} from '../fixtures/signal-golden.mjs';
function evaluated(change=()=>{}){
 const market=entryInput(),portfolio=valuePortfolio({holdings:[],cash:'100000',cashVerified:true,reconciled:true,asOf:market.now});
 const input={portfolio,isin:'INE000000001',sector:'TECH',entry:market.quote.price,stop:structuralStop(market.event.lastLow,market.tick,market.quote.price).stop,regime:'GREEN',lotSize:1,estimatedFees:'0',lossStreakPass:true};
 change(market,input);const sizing=sizeEntry(input);market.riskGates=entrySizingGates(sizing,1,input.lossStreakPass);const decision=evaluateEntry(market);
 return {decision,sizing,reasons:[],live:true,expiresAt:decision.expiresAt,now:market.now};
}
test('affirmative entry combines real strategy and exact portfolio sizing without creating execution',()=>{
 const input=evaluated(),result=authorizeEntryPlan(input);assert.equal(result.state,'BUY_ELIGIBLE');assert.equal(result.quantity,56);assert.deepEqual(result.reasons,[]);assert.equal(Object.hasOwn(result,'fill'),false);
 const yellow=evaluated((market,size)=>{market.regime='YELLOW';size.regime='YELLOW'});assert.equal(authorizeEntryPlan(yellow).quantity,28);
 for(const change of [(m)=>{m.heartbeatAt='2026-02-21T05:58:00Z'},(m)=>{m.brokerSettled='UNKNOWN'},(m)=>{m.gates.G06='FAIL'},(m,s)=>{m.regime='RED';s.regime='RED'},(_m,s)=>{s.sector=null},(_m,s)=>{s.lossStreakPass=false}]){const blocked=authorizeEntryPlan(evaluated(change));assert.equal(blocked.state,'BUY_BLOCKED');assert.equal(blocked.quantity,0);assert.ok(blocked.reasons.length)}
});
test('source failures, observation loss, expiry and invalid quantities cannot be overridden by passing sub-results',()=>{
 const input=evaluated();
 for(const patch of [{live:false},{expiresAt:input.now},{expiresAt:'invalid'},{reasons:['G07_UNKNOWN']},{sizing:{...input.sizing,quantity:0}},{sizing:{...input.sizing,quantity:1.5}},{sizing:null},{decision:{state:'UNKNOWN',reasons:[]}}]){const result=authorizeEntryPlan({...input,...patch});assert.equal(result.state,'BUY_BLOCKED');assert.equal(result.quantity,0)}
});
test('renewing cache lifetime does not replace quote observation, while price/sequence/source changes do',()=>{
 const quote={listingId:'listing',ltp:'101',sequence:'1',sourceAt:'2026-10-28T06:00:00Z',mappingRevision:'mapping',validUntil:'2026-10-28T06:00:10Z'};
 assert.equal(sameEntryQuote(quote,{...quote,validUntil:'2026-10-28T06:00:15Z'}),true);
 for(const patch of [{ltp:'102'},{sequence:'2'},{mappingRevision:'new'},{sourceAt:'2026-10-28T06:00:01Z'}])assert.equal(sameEntryQuote(quote,{...quote,...patch}),false);
});
