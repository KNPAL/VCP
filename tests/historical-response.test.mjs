import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistoricalResponse,classifyBrokerResponse,historicalProbe,dateAfter} from '../packages/market-data/dist/index.js';
const listingId='11111111-1111-4111-8111-111111111111';
const mapping={id:'synthetic-mapping',knownAt:'2026-01-01T00:00:00Z',sourceReference:'synthetic',rows:[{companyId:listingId,listingId,isin:'INE000000001',exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'ANGEL_ONE',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]};
const calendar=['2026-10-15','2026-10-16'].map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-01-01T00:00:00Z',source:'synthetic',verified:true}));
const row=(date,time='00:00:00')=>[date+'T'+time+'+05:30','100.123456','101.123456','99.123456','100.123456','9007199254740993'];
const input={listingId,mapping,calendar,request:{exchange:'NSE',symbolToken:'123',from:'2026-10-15',to:'2026-10-16'},receivedAt:'2026-10-18T00:00:00Z',rows:calendar.map(day=>row(day.date))};
const extraDay={...calendar[0],date:'2026-10-14',opensAt:'2026-10-14T03:45:00Z',closesAt:'2026-10-14T10:00:00Z',finalizedAt:'2026-10-14T10:30:00Z'};
export const probeInput={asOf:input.receivedAt,auth:{authenticated:true,staticIpVerified:true,verifiedAt:'2026-10-17T00:00:00Z',expiresAt:'2026-10-19T00:00:00Z'},quota:{verified:true,knownAt:'2026-10-17T00:00:00Z',second:3,minute:40,hour:5000},wide:{...input,calendar:[extraDay,...calendar],request:{...input.request,from:'2026-10-14'},rows:[row('2026-10-14'),...input.rows]},narrow:[{...input,calendar:[extraDay,calendar[0]],request:{...input.request,from:'2026-10-14',to:'2026-10-15'},rows:[row('2026-10-14'),input.rows[0]]},input]};
test('overlapping account probes record observed coverage and conservative effective quotas',()=>{
 const result=historicalProbe(probeInput);assert.equal(result.status,'PASSED');assert.deepEqual(result.effectiveQuota,{second:1,minute:40,hour:3000});assert.equal(result.wide.actualCount,3);assert.equal(result.wide.actualFrom,'2026-10-14');assert.equal(historicalProbe(probeInput).revision,result.revision);
});
test('account probes fail on conflicting overlap and retain unknown auth, quota and future evidence',()=>{
 const changed=structuredClone(probeInput);changed.narrow[1]={...changed.narrow[1],rows:changed.narrow[1].rows.map((r,i)=>i===0?[...r.slice(0,4),'100.5',r[5]]:r)};const mismatch=historicalProbe(changed);assert.equal(mismatch.status,'FAILED');assert.ok(mismatch.reasons.includes('OVERLAP_VALUE_MISMATCH'));
 for(const patch of [{auth:null},{quota:null},{asOf:'2026-10-17T12:00:00Z'},{narrow:[probeInput.narrow[0]]}])assert.equal(historicalProbe({...probeInput,...patch}).status,'UNKNOWN');
 const truncated=historicalProbe({...probeInput,wide:{...probeInput.wide,rows:[probeInput.wide.rows[0]]}});assert.equal(truncated.status,'FAILED');assert.ok(truncated.reasons.includes('DATA_INCOMPLETE'));
});
test('daily timestamps support midnight and verified session open; numeric JSON lexemes remain exact',()=>{
 const parsed=classifyBrokerResponse({status:200,contentType:'application/json',body:'{"status":true,"data":[["2026-10-15T00:00:00+05:30",100.123456,101.123456,99.123456,100.123456,9007199254740993]]}'});
 assert.equal(parsed.ok,true);assert.equal(parsed.data[0][5],'9007199254740993');
 const result=normalizeHistoricalResponse({...input,rows:[parsed.data[0],row('2026-10-16','09:15:00')]});
 assert.equal(result.status,'COMPLETE');assert.equal(result.bars[0].open,'100.123456');assert.equal(result.bars[0].volume,'9007199254740993');assert.equal(result.expectedCount,2);
});
test('malformed tuples, intraday times, invalid prices and contradictory duplicates remain incomplete',()=>{
 for(const bad of [[...row('2026-10-16').slice(0,5),123],row('2026-10-16','10:00:00'),['2026-10-16T00:00:00+05:30','102','101','99','100','1']]){
  const result=normalizeHistoricalResponse({...input,rows:[input.rows[0],bad]});assert.equal(result.status,'INCOMPLETE');assert.equal(result.actualCount,1);assert.equal(result.missing[0].session,'2026-10-16');
 }
 const duplicate=[...input.rows[1]];duplicate[4]='100.5';const result=normalizeHistoricalResponse({...input,rows:[...input.rows,duplicate]});assert.ok(result.reasons.includes('CONTRADICTORY_DUPLICATE'));assert.equal(result.actualCount,1);
});
test('unverified calendar and mismatched or future mappings never establish coverage',()=>{
 for(const patch of [{calendar:null},{mapping:null},{request:{...input.request,symbolToken:'456'}},{mapping:{...mapping,knownAt:'2027-01-01T00:00:00Z'}}])assert.equal(normalizeHistoricalResponse({...input,...patch}).status,'UNKNOWN');
 const empty=normalizeHistoricalResponse({...input,rows:[]});assert.equal(empty.status,'INCOMPLETE');assert.equal(empty.missing.length,2);
});
test('raw counts cannot mask missing sessions or a 500-row truncation boundary',()=>{
 const result=normalizeHistoricalResponse({...input,rows:Array.from({length:500},()=>input.rows[0])});assert.equal(result.rawResponseCount,500);assert.equal(result.actualCount,1);assert.ok(result.reasons.includes('POSSIBLE_500_RECORD_TRUNCATION'));
 assert.equal(normalizeHistoricalResponse({...input,rows:[...input.rows].reverse()}).dataRevision,normalizeHistoricalResponse(input).dataRevision);
});
test('multi-year response coverage is checked against overlapping smaller windows',()=>{
 const days=Array.from({length:740},(_,i)=>dateAfter('2024-01-01',i));
 const allCalendar=days.map(date=>({...calendar[0],date,knownAt:'2023-01-01T00:00:00Z',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z'}));
 const window=(from,to)=>({...input,calendar:allCalendar,mapping:{...mapping,knownAt:'2023-01-01T00:00:00Z'},request:{...input.request,from:days[from],to:days[to]},rows:days.slice(from,to+1).map(date=>row(date))});
 const probe={...probeInput,wide:window(0,739),narrow:[window(0,399),window(350,739)]};
 assert.equal(historicalProbe(probe).status,'PASSED');
 const truncated=historicalProbe({...probe,wide:{...probe.wide,rows:probe.wide.rows.slice(0,500)}});assert.equal(truncated.status,'FAILED');assert.equal(truncated.wide.missing.length,240);assert.ok(truncated.reasons.includes('POSSIBLE_500_RECORD_TRUNCATION'));
});

