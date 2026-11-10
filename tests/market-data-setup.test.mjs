import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {csvRows,buildCatalog} from '../apps/api/dist/market-data-setup.js';
import {setupCalendar} from '../apps/api/dist/setup-calendar.js';
import {previewDownloadRange} from '../packages/market-data/dist/index.js';
const asOf='2026-11-10T12:00:00.000Z';
test('CSV handles quoted fields and rejects malformed input',()=>{assert.deepEqual(csvRows('Symbol,Name\nABC,"Company, Ltd"\n'),[{SYMBOL:'ABC',NAME:'Company, Ltd'}]);assert.throws(()=>csvRows('a,b\n"broken'));assert.throws(()=>csvRows('a,b\n1,2,3'));});
test('catalog joins exact ISIN and broker symbol without inventing old membership',()=>{
 const master=[],eq=['SYMBOL,SERIES,ISIN NUMBER,DATE OF LISTING'],members=['Symbol,Series,ISIN Code'];
 for(let i=0;i<450;i++){const symbol='STOCK'+i,isin='INE'+String(i).padStart(9,'0');master.push({exch_seg:'NSE',symbol:symbol+'-EQ',token:String(i+1),instrumenttype:'',expiry:'',tick_size:'5.000000',lotsize:'1'});eq.push(`${symbol},EQ,${isin},01-Jan-2020`);members.push(`${symbol},EQ,${isin}`)}
 const result=buildCatalog(master,eq.join('\n'),members.join('\n'),asOf);assert.equal(result.rows.length,450);assert.equal(result.rows[0].tick,'0.050000');assert.equal(result.rows[0].validFrom,'2026-11-10');
 master.push(master[0]);const ambiguous=buildCatalog(master,eq.join('\n'),members.join('\n'),asOf);assert.equal(ambiguous.rows.length,449);assert.match(ambiguous.excluded[0],/ambiguous/);
});
test('calendar includes Budget weekend sessions and Muhurat post-close, excludes election closure',async()=>{
 const data=JSON.parse(await readFile('data/nse-cm-holidays-2015-2026.json','utf8')),calendar=setupCalendar(data.holidays,asOf,'a'.repeat(64)),day=date=>calendar.find(r=>r.date===date);
 assert.equal(day('2025-02-01').kind,'SPECIAL');assert.equal(day('2026-02-01').kind,'SPECIAL');assert.equal(day('2026-01-15').kind,'HOLIDAY');assert.equal(day('2026-11-08').opensAt,'2026-11-08T08:50:00.000Z');assert.equal(day('2026-11-08').closesAt,'2026-11-08T10:30:00.000Z');
 const input={fromDate:'2026-11-01',toDate:'2026-11-09',asOf,interval:'1d',mode:'MISSING_ONLY',listingId:'11111111-1111-4111-a111-111111111111',provider:'ANGEL_ONE',listingDate:'2020-01-01',calendar,bars:[],providerFinalSession:null};
 assert.equal(previewDownloadRange(input).state,'BLOCKED');assert.equal(previewDownloadRange({...input,allowInitialDownload:true}).state,'KNOWN');assert.ok(previewDownloadRange({...input,allowInitialDownload:true}).missingCount>0);
 assert.equal(previewDownloadRange({...input,toDate:'2026-11-10',allowInitialDownload:true}).state,'BLOCKED');
});
import {verifiedCalendar} from '../packages/market-data/dist/index.js';
test('calendar memoization cannot hide mutable changes or expose cached result arrays',()=>{
 const day={date:'2026-11-09',kind:'TRADING',opensAt:'2026-11-09T03:45:00Z',closesAt:'2026-11-09T10:30:00Z',finalizedAt:'2026-11-09T11:00:00Z',knownAt:'2026-11-01T00:00:00Z',source:'test',verified:true};
 const mutable=[{...day}];assert.equal(verifiedCalendar(mutable,day.date,day.date,asOf).state,'KNOWN');mutable[0].verified=false;assert.equal(verifiedCalendar(mutable,day.date,day.date,asOf).state,'UNKNOWN');
 const frozen=Object.freeze([Object.freeze({...day})]),first=verifiedCalendar(frozen,day.date,day.date,asOf);first.sessions.length=0;first.reasons.push('tampered');const next=verifiedCalendar(frozen,day.date,day.date,asOf);assert.equal(next.sessions.length,1);assert.deepEqual(next.reasons,[]);assert.equal(verifiedCalendar(frozen,day.date,day.date,'2026-11-09T10:00:00Z').sessions.length,0);
});
