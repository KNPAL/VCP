import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedHistoricalGateway} from '../apps/worker/dist/historical-gateway.js';
const listingId='11111111-1111-4111-8111-111111111111',date='2026-10-16',now=()=> '2026-10-18T12:00:00Z';
const calendar=[{date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic',verified:true}];
const mapping={id:'synthetic',knownAt:'2026-01-01T00:00:00Z',sourceReference:'synthetic',rows:[{companyId:listingId,listingId,isin:'INE000000001',exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'ANGEL_ONE',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]};
const input={listingId,exchange:'NSE',symbolToken:'123',mapping,calendar,now};
const window={from:date,to:date,sessions:[date]},row=[date+'T00:00:00+05:30','100','101','99','100','1000'];
const success=data=>({state:'KNOWN',data,code:null,reason:null,requestId:'synthetic',attempts:1});
test('normalized gateway preserves missing responses for subdivision and exact accepted candles',async()=>{
 let requested;const gateway=normalizedHistoricalGateway({...input,request:async value=>{requested=value;return success([row])}});
 const bars=await gateway.fetch(window);assert.equal(bars[0].listingId,listingId);assert.equal(bars[0].receivedAt,now());assert.equal(bars[0].volume,'1000');assert.deepEqual(requested,{exchange:'NSE',symbolToken:'123',from:date,to:date});
 assert.deepEqual(await normalizedHistoricalGateway({...input,request:async()=>success([])}).fetch(window),[]);
});
test('unknown identity and changed expected sessions are rejected before any broker request',async()=>{
 let calls=0;const request=async()=>{calls++;return success([row])};
 await assert.rejects(normalizedHistoricalGateway({...input,mapping:null,request}).fetch(window),/BROKER_RESPONSE_SCOPE_MISMATCH/);
 await assert.rejects(normalizedHistoricalGateway({...input,request}).fetch({...window,sessions:[]}),/BROKER_RESPONSE_SCOPE_MISMATCH/);assert.equal(calls,0);
});
test('malformed and contradictory rows cannot disappear into a successful checkpoint',async()=>{
 for(const rows of [[row,['bad']],[row,[...row.slice(0,4),'100.5','1000']],[row,[date+'T12:00:00+05:30',...row.slice(1)]]])await assert.rejects(normalizedHistoricalGateway({...input,request:async()=>success(rows)}).fetch(window),/INVALID_BROKER_RESPONSE/);
});
test('broker retry delay is propagated without exposing raw errors',async()=>{
 await assert.rejects(normalizedHistoricalGateway({...input,request:async()=>({state:'UNKNOWN',reason:'RATE_LIMITED',retryAfterMs:60000,data:null})}).fetch(window),error=>error.message==='RATE_LIMITED'&&error.retryAfterMs===60000);
});
