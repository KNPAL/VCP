import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {protectiveDecision,openEpisode} from '../packages/portfolio/dist/index.js';
const asOf='2026-10-20T06:00:00Z',stop={listingId:'listing',activeStop:'95.000000',scaleRevision:'basis',effectiveAt:'2026-10-20T05:59:00Z'},quote={listingId:'listing',ltp:'95.000000',sourceAt:asOf,receivedAt:asOf,session:'2026-10-20',quality:'FRESH',connection:'CONNECTED',validUntil:'2026-10-20T06:00:30Z'};
test('protective SELL includes observed gap price; stale, pre-stop and changed scales cannot trigger',()=>{
 const run=(q=quote,s=stop,basis='basis',qty=3)=>protectiveDecision(s,q,basis,qty,asOf);
 assert.equal(run().state,'SELL_PROTECTIVE');assert.equal(run({...quote,ltp:'90.000000'}).triggeredPrice,'90.000000');assert.equal(run({...quote,ltp:'95.050000'}).state,'NOT_BREACHED');assert.equal(run().executable,false);
 for(const q of [null,{...quote,validUntil:asOf},{...quote,sourceAt:'2026-10-20T05:58:59Z'},{...quote,sourceAt:'2026-10-20T06:00:01Z'},{...quote,connection:'DISCONNECTED'},{...quote,listingId:'other'},{...quote,session:'2026-10-19'}])assert.equal(run(q).state,'UNABLE_TO_EVALUATE');
 assert.equal(run(quote,null).state,'UNABLE_TO_EVALUATE');assert.equal(run(quote,stop,'changed').state,'UNABLE_TO_EVALUATE');assert.equal(run(quote,stop,null).state,'UNABLE_TO_EVALUATE');assert.equal(run(quote,stop,'basis',0).state,'CLOSED');
 assert.equal(run({...quote,sourceAt:'2026-10-20T05:59:20Z'},{...stop,effectiveAt:'2026-10-20T05:59:30Z'}).state,'UNABLE_TO_EVALUATE');
});
test('position episode keeps first BUY across partial sells and top-ups, resets after closure',()=>{
 const base={occurredAt:'2026-10-20T05:00:00Z',recordedAt:'2026-10-20T05:00:00Z',sourceId:'test',author:'owner'},events=[{...base,id:randomUUID(),sequence:1,kind:'INITIAL_CAPITAL',amount:'1000',verified:true}],isin='INE000000001';
 const fill=(side,quantity)=>{const event={...base,id:randomUUID(),sequence:events.length+1,kind:'FILL',isin,side,quantity,price:'100',fees:'0',brokerReference:randomUUID()};events.push(event);return event};
 const first=fill('BUY',5);fill('SELL',2);fill('BUY',2);assert.equal(openEpisode(events,isin,asOf).identity,first.id);assert.equal(openEpisode(events,isin,asOf).quantity,5);fill('SELL',5);assert.equal(openEpisode(events,isin,asOf),null);const next=fill('BUY',1);assert.equal(openEpisode(events,isin,asOf).identity,next.id);
});

