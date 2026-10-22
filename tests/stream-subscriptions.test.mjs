import test from 'node:test';
import assert from 'node:assert/strict';
import {planStreamSubscriptions,decodeSmartApiLtp,streamSubscriptionDelta,smartApiSubscriptionMessage} from '../packages/market-data/dist/index.js';
const asOf='2026-10-21T06:00:00Z',validUntil='2026-10-21T10:00:00Z';
const rows=Array.from({length:5},(_,i)=>({companyId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,listingId:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,isin:'INE'+String(i+1).padStart(9,'0'),exchange:'NSE',series:'EQ',symbol:'TEST'+i,instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'smartapi',token:String(i+1),validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}));
const mapping={id:'fixture',knownAt:'2026-10-20T00:00:00Z',sourceReference:'synthetic',rows};
test('stream selection prioritizes holdings, READY, then nearest WATCH and deduplicates',()=>{
 const candidates=[{isin:rows[0].isin,state:'WATCH',distanceToPivot:'0.01',validUntil},{isin:rows[1].isin,state:'WATCH',distanceToPivot:'0.4',validUntil},{isin:rows[2].isin,state:'READY',distanceToPivot:'1',validUntil},{isin:rows[3].isin,state:'WATCH',distanceToPivot:'0.1',validUntil}];
 const run=(overrides={})=>planStreamSubscriptions({holdings:[rows[0].isin,rows[0].isin],candidates,mapping,provider:'smartapi',asOf,capacity:3,...overrides});
 const result=run();assert.deepEqual(result.subscriptions.map(s=>s.token),['1','3','4']);assert.deepEqual(result.subscriptions.map(s=>s.priority),['HOLDING','READY','WATCH']);assert.equal(result.rejected[0].reason,'STREAM_CAPACITY_EXCEEDED');assert.equal(result.executable,false);
 assert.equal(run({candidates:candidates.map(c=>({...c,validUntil:asOf}))}).subscriptions.length,1);
 assert.equal(run({mapping:{...mapping,knownAt:validUntil}}).subscriptions.length,0);
 assert.equal(run({mapping:{...mapping,rows:rows.map(r=>({...r,validTo:'2026-10-21'}))}}).subscriptions.length,0);
 const ambiguous=run({mapping:{...mapping,rows:rows.map((r,i)=>i===4?{...r,token:'1'}:r)}});assert.ok(!ambiguous.subscriptions.some(s=>s.token==='1'));assert.equal(ambiguous.rejected[0].reason,'AMBIGUOUS_TOKEN');
 const next=run({holdings:[rows[4].isin],candidates:[]}).subscriptions,delta=streamSubscriptionDelta(result.subscriptions,next);
 assert.equal(delta.remove.length,3);assert.equal(delta.add.length,1);assert.deepEqual(streamSubscriptionDelta(next,next),{remove:[],add:[]});
 assert.deepEqual(smartApiSubscriptionMessage(1,[...next,...next],'restore1').params.tokenList,[{exchangeType:1,tokens:['5']}]);
});
test('SmartAPI binary LTP decoding preserves int64 precision and rejects unsupported frames',()=>{
 const frame=Buffer.alloc(51);frame[0]=1;frame[1]=1;frame.write('123',2);frame.writeBigInt64LE(9007199254740993n,27);frame.writeBigInt64LE(BigInt(Date.parse(asOf)),35);frame.writeBigInt64LE(10005n,43);
 const tick=decodeSmartApiLtp(frame,'smartapi');assert.equal(tick.sequence,'9007199254740993');assert.equal(tick.rawLtp,'10005');assert.equal(tick.sourceAt,'2026-10-21T06:00:00.000Z');assert.equal(tick.priceDecimals,2);
 for(const size of [0,50,52])assert.equal(decodeSmartApiLtp(Buffer.alloc(size),'smartapi'),null);
 const invalid=Buffer.from(frame);invalid[0]=2;assert.equal(decodeSmartApiLtp(invalid,'smartapi'),null);invalid[0]=1;invalid[1]=2;assert.equal(decodeSmartApiLtp(invalid,'smartapi'),null);invalid[1]=1;invalid.writeBigInt64LE(-1n,27);assert.equal(decodeSmartApiLtp(invalid,'smartapi'),null);
 const offset=Buffer.concat([Buffer.alloc(3),frame]).subarray(3);assert.deepEqual(decodeSmartApiLtp(offset,'smartapi'),tick);
});
