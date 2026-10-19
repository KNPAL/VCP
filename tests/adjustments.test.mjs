import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustCandles} from '../packages/market-data/dist/index.js';
import {vdu,adv20} from '../packages/indicators/dist/index.js';
const listingId='00000000-0000-4000-8000-000000000001';
const action={id:'split-1',listingId,kind:'SPLIT',effectiveAt:'2026-10-16T03:45:00Z',knownAt:'2026-10-15T12:00:00Z',sharesBefore:'1',sharesAfter:'2',verified:true,sourceReference:'synthetic-exchange-notice'};
const source={id:'source-1',listingId,knownAt:'2026-10-16T11:00:00Z',verified:true,sourceReference:'synthetic-register',coverageFrom:'2026-10-01',coverageThrough:'2026-10-16',actions:[action]};
const raw=['2026-10-15','2026-10-16'].map((session,i)=>({listingId,session,provider:'synthetic',open:i?'50':'100',high:i?'55':'110',low:i?'49':'98',close:i?'52':'104',volume:i?'2001':'1001',receivedAt:'2026-10-16T12:00:00Z',finalizedAt:session+'T10:30:00Z',zeroVolumeVerified:false,revisionId:'raw-'+i}));
const input={listingId,asOf:'2026-10-16T12:00:00Z',scaleSession:'2026-10-16',source,raw};

test('split adjustment preserves raw bars, adjusts prior prices and inverse share volume only',()=>{
 const original=structuredClone(raw),result=adjustCandles(input);
 assert.equal(result.state,'KNOWN');assert.deepEqual(raw,original);
 assert.equal(result.bars[0].close,'52.000000');assert.equal(result.bars[0].volume,'2002.00000000');
 assert.equal(result.bars[1].close,'52.000000');assert.equal(result.bars[1].volume,'2001.00000000');assert.deepEqual(result.bars[1].actionIds,[]);
 assert.equal(adjustCandles({...input,raw:[...raw].reverse()}).revision,result.revision);
 assert.equal(adjustCandles({...input,source:Object.fromEntries(Object.entries(source).reverse())}).revision,result.revision);
});

test('bonus fractions and chained split factors retain fractional adjusted volume without share rounding',()=>{
 const bonus={...action,id:'bonus',kind:'BONUS',sharesBefore:'2',sharesAfter:'3'};
 const result=adjustCandles({...input,source:{...source,actions:[bonus]}});
 assert.equal(result.bars[0].volume,'1501.50000000');assert.equal(result.bars[0].close,'69.333333');
 const chained=adjustCandles({...input,source:{...source,actions:[action,bonus]}});
 assert.equal(chained.bars[0].volume,'3003.00000000');assert.deepEqual(chained.bars[0].priceFactor,{numerator:'1',denominator:'3'});
});

test('unverified, incomplete and future-known action evidence cannot produce usable bars',()=>{
 for(const change of [{verified:false},{coverageFrom:'2026-10-16'},{knownAt:'2026-10-17T00:00:00Z'},{actions:[{...action,verified:false}]}]){
  const result=adjustCandles({...input,source:{...source,...change}});assert.equal(result.state,'UNKNOWN');assert.equal(result.signalsAllowed,false);assert.equal(result.bars.length,0);
 }
 assert.equal(adjustCandles({...input,source:{...source,actions:[]}}).state,'KNOWN');
 assert.throws(()=>adjustCandles({...input,source:{...source,actions:[action,action]}}),/DUPLICATE/);
 assert.throws(()=>adjustCandles({...input,source:{...source,actions:[{...action,sharesAfter:'0'}]}}),/INVALID_CORPORATE_ACTION/);
});

test('corrections change the adjustment revision and retain independent source lineage',()=>{
 const a=adjustCandles(input),b=adjustCandles({...input,source:{...source,id:'corrected-source',actions:[{...action,sharesAfter:'3'}]}});
 assert.notEqual(a.revision,b.revision);assert.equal(a.bars[0].close,'52.000000');assert.equal(b.bars[0].close,'34.666667');
 assert.notEqual(a.revision,adjustCandles({...input,raw:raw.map((bar,i)=>({...bar,revisionId:'corrected-'+i}))}).revision);
});

test('adjusted fractional volume works in indicator ratios while raw turnover rejects fractional shares',()=>{
 const sessions=Array.from({length:20},(_,i)=>'2026-09-'+String(i+1).padStart(2,'0'));
 const series={priceScale:'ADJUSTED',asOf:input.asOf,dataRevision:'adjusted-fixture',sessions,bars:sessions.map(session=>({session,open:'100',high:'110',low:'99',close:'105',volume:'1501.50000000',revision:'a1',finalizedAt:session+'T10:30:00Z',adjustmentVerified:true}))};
 assert.equal(vdu(series).value,'1.00000000');assert.equal(adv20({...series,priceScale:'RAW'}).state,'UNKNOWN');
});
