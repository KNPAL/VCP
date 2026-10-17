import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness,sourcePermission,surveillance,benchmarkReadiness} from '../packages/market-data/dist/index.js';
const now='2026-10-16T06:00:00Z';
const proof={id:'proof-1',gate:'G01',status:'PASS',probeAt:now,sourceAt:now,expiresAt:'2026-10-16T06:01:00Z',sourceReference:'synthetic-evidence',reason:null,details:{staticIpVerified:true}};
const source={dataset:'candles',provider:'fixture',endpointOrFile:'fixture.json',licenseRef:'synthetic-license',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'daily',asOf:now,knownAt:now,effectiveAt:now,validUntil:'2026-10-17T06:00:00Z',lastVerified:now,maximumAgeMs:60000,adjustmentPolicy:'raw retained',coverage:{intended:1,available:1},error:null};
test('all ten readiness gates default UNKNOWN with capability-specific blocks',()=>{
 const result=readiness([],now);assert.equal(result.items.length,10);assert.equal(result.buyAllowed,false);assert.equal(result.monitoring,'MONITOR_DEGRADED');assert.ok(result.items.every(x=>x.status==='UNKNOWN'));
 const first=readiness([proof],now);assert.equal(first.items[0].status,'PASS');assert.equal(first.buyAllowed,false);
 assert.equal(readiness([proof],proof.expiresAt).items[0].status,'UNKNOWN');
 assert.equal(readiness([{...proof,probeAt:'2026-10-16T06:00:01Z'}],now).items[0].status,'UNKNOWN');
 assert.equal(readiness([{...proof,sourceReference:null}],now).items[0].status,'UNKNOWN');
});
test('licensing is per operation; stale, future and missing sources never grant access',()=>{
 assert.equal(sourcePermission(source,'STORE',now).status,'PASS');assert.equal(sourcePermission(source,'REDISTRIBUTE',now).status,'FAIL');
 assert.equal(sourcePermission(null,'STORE',now).status,'UNKNOWN');
 assert.equal(sourcePermission({...source,licenseRef:null},'STORE',now).status,'UNKNOWN');
 assert.equal(sourcePermission(source,'STORE','2026-10-16T06:01:01Z').status,'UNKNOWN');
 assert.equal(sourcePermission({...source,knownAt:'2026-10-17T06:00:00Z'},'STORE',now).status,'UNKNOWN');
});
test('surveillance needs explicit current unrestricted status and valid price bands',()=>{
 const data={verified:true,knownAt:now,sourceAt:now,validUntil:'2026-10-17T06:00:00Z',asm:false,gsm:false,esm:false,cashTradable:true,lowerBand:'90',upperBand:'110'};
 assert.equal(surveillance(data,now).status,'PASS');assert.equal(surveillance({...data,asm:true},now).status,'FAIL');assert.equal(surveillance({...data,gsm:null},now).status,'UNKNOWN');assert.equal(surveillance(data,data.validUntil).status,'UNKNOWN');assert.equal(surveillance({...data,upperBand:null},now).status,'UNKNOWN');
});
test('benchmark needs 252 aligned completed sessions with independently verified identity',()=>{
 const dates=Array.from({length:252},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
 const data={identifier:'NIFTY_500_PRICE',identityVerified:true,calendarVerified:true,expectedSessions:dates,bars:dates.map(session=>({session,close:'100',finalizedAt:session+'T11:00:00Z',adjustmentVerified:true,sourceRevision:'r1'})),asOf:now};
 assert.equal(benchmarkReadiness(data).status,'PASS');
 for(const update of [{identifier:'NIFTY_50'},{identityVerified:false},{calendarVerified:false},{bars:data.bars.slice(1)},{expectedSessions:dates.slice(1),bars:data.bars.slice(1)}]){const result=benchmarkReadiness({...data,...update});assert.equal(result.status,'UNKNOWN');assert.equal(result.riskMultiplier,'0')}
});
