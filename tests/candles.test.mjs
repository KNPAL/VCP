import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCalendar,inspectCandleBatch,candleHash,validateCandle} from '../packages/market-data/dist/index.js';
const listingId='00000000-0000-4000-8000-000000000001',provider='fixture-provider',asOf='2026-10-18T12:00:00Z';
const trading=date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic-calendar',verified:true});
const holiday={date:'2026-10-17',kind:'HOLIDAY',opensAt:null,closesAt:null,finalizedAt:null,knownAt:'2026-01-01T00:00:00Z',source:'synthetic-calendar',verified:true};
const calendar=[trading('2026-10-16'),holiday,{...trading('2026-10-18'),kind:'SPECIAL'}];
const candle=session=>({listingId,session,provider,open:'100',high:'110',low:'99',close:'105',volume:'1000',receivedAt:asOf,finalizedAt:session+'T10:30:00Z',zeroVolumeVerified:false});
const inspect=bars=>inspectCandleBatch({bars,calendar,from:'2026-10-16',to:'2026-10-18',asOf,listingId,provider});
test('official classifications govern holidays and special sessions rather than weekday assumptions',()=>{
 const result=inspect([candle('2026-10-16'),candle('2026-10-18')]);assert.equal(result.state,'COMPLETE');assert.equal(result.expectedCount,2);
 assert.deepEqual(inspect([candle('2026-10-16')]).missing,[{session:'2026-10-18',reason:'DATA_INCOMPLETE'}]);
 assert.equal(verifiedCalendar([calendar[0]],'2026-10-16','2026-10-18',asOf).state,'UNKNOWN');
 assert.equal(verifiedCalendar(null,'2026-10-16','2026-10-18',asOf).state,'UNKNOWN');
});
test('auction-finalization timing prevents provisional close from becoming final',()=>{
 const provisional={...candle('2026-10-16'),finalizedAt:'2026-10-16T10:00:00Z'};
 assert.ok(inspect([provisional]).quarantined[0].reasons.includes('CANDLE_NOT_FINAL'));
 assert.equal(verifiedCalendar(calendar,'2026-10-16','2026-10-16','2026-10-16T10:15:00Z').sessions.length,0);
});
test('invalid OHLCV and unverified zero volume are quarantined without interpolation',()=>{
 for(const change of [{high:'90'},{low:'106'},{close:'0'},{volume:'-1'},{volume:'0'},{volume:'1.5'},{receivedAt:'2026-10-19T00:00:00Z'}])assert.equal(validateCandle({...candle('2026-10-16'),...change},asOf).valid,false);
 assert.equal(validateCandle({...candle('2026-10-16'),volume:'0',zeroVolumeVerified:true},asOf).valid,true);
});
test('identical bytes collapse, formatting does not change hash and contradictory duplicates reject both',()=>{
 const bar=candle('2026-10-16');assert.equal(candleHash(bar),candleHash({...bar,open:'100.000000'}));
 assert.equal(inspect([bar,bar]).actualCount,1);
 const conflict=inspect([bar,{...bar,close:'106'}]);assert.equal(conflict.actualCount,0);assert.equal(conflict.quarantined.length,2);
 assert.ok(inspect([{...bar,provider:'another'}]).quarantined[0].reasons.includes('SOURCE_MISMATCH'));
});
