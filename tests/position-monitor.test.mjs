import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHeldQuote,normalizeLiveTick} from '../packages/market-data/dist/index.js';
const asOf='2026-10-20T06:00:00Z',isin='INE000000001',listingId='00000000-0000-4000-8000-000000000002';
const mapping={id:'test',knownAt:'2020-01-01T00:00:00Z',sourceReference:'fixture',rows:[{companyId:'00000000-0000-4000-8000-000000000001',isin,listingId,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]};
const day={date:'2026-10-20',kind:'TRADING',opensAt:'2026-10-20T03:45:00Z',closesAt:'2026-10-20T10:00:00Z',finalizedAt:null,knownAt:'2026-10-19T00:00:00Z',source:'fixture',verified:true};
const quote=normalizeLiveTick({provider:'fixture',token:'123',exchange:'NSE',rawLtp:'10000',priceDecimals:2,sourceAt:asOf,sequence:'1'},mapping,day,asOf,true);quote.quote.validUntil='2026-10-20T06:00:30Z';
test('held stock freshness is orthogonal to trading decisions and verified sessions',()=>{
 const check=(q=quote,c=[day],m=mapping,t=asOf)=>assessHeldQuote(isin,t,c,m,q);
 assert.equal(check().state,'FEED_FRESH');assert.equal(check().executable,false);
 assert.equal(check({state:'UNKNOWN',reason:'FEED_DISCONNECTED'}).state,'MONITOR_DEGRADED');
 assert.equal(check(quote,null).reason,'CALENDAR_UNAVAILABLE');assert.equal(check(quote,[day],null).reason,'TOKEN_MAPPING_UNAVAILABLE');
 assert.equal(check({...quote,quote:{...quote.quote,token:'456'}}).state,'MONITOR_DEGRADED');
 assert.equal(check({...quote,quote:{...quote.quote,sourceAt:'2026-10-20T05:58:59Z'}}).state,'MONITOR_DEGRADED');
 assert.equal(check({...quote,quote:{...quote.quote,sourceAt:'2026-10-20T06:00:01Z'}}).state,'MONITOR_DEGRADED');
 assert.equal(check(quote,[day],mapping,'2026-10-20T10:01:00Z').state,'SESSION_CLOSED');
 assert.equal(check(quote,[{...day,kind:'HOLIDAY',opensAt:null,closesAt:null}]).state,'SESSION_CLOSED');
 assert.equal(check(quote,[{...day,verified:false}]).state,'MONITOR_DEGRADED');
});

