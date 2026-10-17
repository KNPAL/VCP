import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInstrumentSnapshot,canonicalListings,universeAt,sectorAt} from '../packages/market-data/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,isin='INE000000001',asOf='2026-10-16T06:00:00Z';
const mapping=(overrides={})=>({companyId:id(1),isin,listingId:id(2),exchange:'NSE',series:'EQ',symbol:'SYNTH-EQ',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true,...overrides});
const snapshot=rows=>({id:'master-1',knownAt:'2026-10-01T00:00:00Z',sourceReference:'fixture-master',rows});
test('NSE EQ wins, verified BSE cash falls back and other exchanges remain visible',()=>{
 const nse=mapping(),bse=mapping({listingId:id(3),exchange:'BSE',series:'CASH',token:'456'});
 const first=canonicalListings([snapshot([bse,nse])],[isin,isin],asOf);assert.equal(first.length,1);assert.equal(first[0].primary.listingId,id(2));assert.equal(first[0].otherListings.length,1);
 assert.equal(canonicalListings([snapshot([{...nse,enabled:false},bse])],[isin],asOf)[0].primary.listingId,id(3));
 assert.equal(canonicalListings([snapshot([nse,{...nse,listingId:id(4)}])],[isin],asOf)[0].reason,'AMBIGUOUS_CANONICAL_LISTING');
});
test('unsupported, unmapped and future instruments never become screened equity',()=>{
 for(const instrumentType of ['ETF','INDEX','DERIVATIVE','UNKNOWN'])assert.equal(canonicalListings([snapshot([mapping({instrumentType})])],[isin],asOf)[0].primary,null);
 assert.equal(canonicalListings([{...snapshot([mapping()]),knownAt:'2026-10-17T00:00:00Z'}],[isin],asOf)[0].reason,'INSTRUMENT_MAPPING_MISSING');
 assert.throws(()=>validateInstrumentSnapshot(snapshot([mapping({token:'invalid'})])),/INVALID/);
});
test('token changes retain listing identity with nonoverlapping half-open dates',()=>{
 const old=mapping({validTo:'2026-10-15'}),next=mapping({validFrom:'2026-10-15',token:'789',symbol:'RENAMED-EQ'});
 const source=snapshot([old,next]);assert.equal(canonicalListings([source],[isin],'2026-10-14T06:00:00Z')[0].primary.token,'123');assert.equal(canonicalListings([source],[isin],asOf)[0].primary.token,'789');
 assert.throws(()=>validateInstrumentSnapshot(snapshot([mapping(),next])),/OVERLAPPING/);
 assert.throws(()=>validateInstrumentSnapshot(snapshot([mapping(),mapping({companyId:id(4),listingId:id(5)})])),/CONFLICTING/);
});
test('universe selection is point-in-time and missing historical constituents remain biased research',()=>{
 const universe={id:'u1',universe:'NIFTY_500',knownAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:null,sourceReference:'fixture-universe',historicalConstituentsVerified:true,isins:[isin]};
 assert.deepEqual(universeAt([universe],asOf).members,[isin]);
 assert.equal(universeAt([{...universe,knownAt:'2026-10-17T00:00:00Z'}],asOf).state,'UNKNOWN');
 assert.equal(universeAt([{...universe,historicalConstituentsVerified:false}],asOf).bias,'SURVIVORSHIP_BIASED_RESEARCH');
 assert.throws(()=>universeAt([{...universe,isins:[isin,isin]}],asOf),/INVALID_UNIVERSE/);
});
test('sector changes use effective and knowledge dates and reject overlaps',()=>{
 const first={isin,sector:'TECH',validFrom:'2020-01-01',validTo:'2026-10-15',knownAt:'2026-01-01T00:00:00Z',sourceReference:'fixture-sector'},second={...first,sector:'FINANCE',validFrom:'2026-10-15',validTo:null};
 assert.equal(sectorAt([first,second],isin,asOf).sector,'FINANCE');assert.equal(sectorAt([],isin,asOf).status,'UNKNOWN');
 assert.throws(()=>sectorAt([{...first,validTo:null},second],isin,asOf),/OVERLAPPING/);
});
