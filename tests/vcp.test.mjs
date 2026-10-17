import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrema,normalize,assembleLegs,validateLegs,detect,patternId,fullBasePivot,selectPrimary,deduplicateSignals} from '../packages/vcp/dist/index.js';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
const options=s=>({listingId:'00000000-0000-4000-8000-000000000001',tick:'0.05',adjustmentRevision:'verified-1',currentScaleFactor:'1',rs:'85',decidedAt:s.asOf});
test('golden 20/10/5 setup is deterministic with confirmed timestamps and full-base pivot',()=>{
 const s=goldenSeries();const a=detect(s,options(s)),b=detect(s,options(s));assert.deepEqual(a,b);
 const p=a.patterns.find(p=>p.anchor.index===270);assert.ok(p);
 assert.deepEqual(p.legs.map(l=>l.depth),['20.00000000','10.00000000','5.00000000']);
 assert.equal(p.pivot,'100.000000');assert.equal(p.state,'READY');assert.equal(a.primary.id,p.id);
 assert.equal(p.anchor.confirmedAt,s.bars[273].finalizedAt);assert.equal(p.anchor.occurredAt,s.bars[270].endedAt);
 assert.deepEqual(p.reasons,[]);assert.equal(p.stopSource,'92.150000');
});
test('historical prefixes never expose a high before its third right bar',()=>{
 const s=goldenSeries();for(let end=271;end<=273;end++){const p={...s,bars:s.bars.slice(0,end),sessions:s.sessions.slice(0,end),asOf:s.bars[end-1].finalizedAt};assert.ok(!extrema(p).raw.some(x=>x.index===270))}
 const p={...s,bars:s.bars.slice(0,274),sessions:s.sessions.slice(0,274),asOf:s.bars[273].finalizedAt};assert.ok(extrema(p).raw.some(x=>x.index===270));
});
test('earliest equal high and low ties; dual extrema explicitly discarded',()=>{
 const s=goldenSeries();s.bars[271].high='100.000000';assert.ok(!extrema(s).raw.some(x=>x.index===271));assert.ok(extrema(s).raw.some(x=>x.index===270));
 s.bars[277].low='80.000000';assert.ok(!extrema(s).raw.some(x=>x.index===277));
 s.bars[282].low='70';const out=extrema(s);assert.ok(out.ambiguities.some(x=>x.index===282));assert.ok(!out.raw.some(x=>x.index===282));
});
test('normalization retains larger high and smaller low preserving original confirmation',()=>{
 const swing=(kind,index,price)=>({kind,index,price,occurredAt:String(index),confirmedAt:String(index+3),session:String(index)});
 assert.deepEqual(normalize([swing('H',3,'100'),swing('H',5,'100'),swing('H',8,'101'),swing('L',12,'90'),swing('L',15,'89')]),[swing('H',8,'101'),swing('L',15,'89')]);
});
test('leg rejections, tick tolerance, corporate-action identity and frozen pivots',()=>{
 const s=goldenSeries();const p=detect(s,options(s)).patterns.find(p=>p.anchor.index===270);
 const legs=structuredClone(p.legs);legs[2].low.price='88.2';assert.ok(validateLegs(legs,'0.05').includes('LOW_NOT_RISING'));
 legs[2].low.price='80';assert.ok(validateLegs(legs,'0.05').includes('INSUFFICIENT_CONTRACTION'));
 assert.ok(validateLegs(p.legs.slice(0,1),'0.05').includes('LEG_COUNT'));
 assert.notEqual(patternId(p.listingId,p.anchor,'0.05','new-adjustment'),p.id);
 const snapshot=p.pivot;s.bars.at(-1).high='110';assert.equal(fullBasePivot(s,270),'110.000000');assert.equal(p.pivot,snapshot);
 assert.equal(selectPrimary([]),null);
 assert.throws(()=>patternId(p.listingId,{...p.anchor,price:'100.01'},'0.05','x'),/OFF_TICK/);
});
test('missing history, unfinalized data and invalid scale fail closed',()=>{
 const s=goldenSeries();const short={...s,bars:s.bars.slice(260),sessions:s.sessions.slice(260)};assert.equal(detect(short,options(short)).patterns.length,0);
 s.bars.at(-1).finalizedAt=null;assert.throws(()=>detect(s,options(s)),/INCOMPLETE/);
 const good=goldenSeries();assert.throws(()=>assembleLegs(good,extrema(good).swings,'0'),/INVALID_SCALE/);
});
test('READY boundaries, developing minimum duration, invalidation and day-91 expiration',()=>{
 const s=goldenSeries();const at=n=>({...s,bars:s.bars.slice(0,n),sessions:s.sessions.slice(0,n),asOf:s.bars[n-1].finalizedAt});
 assert.ok(!detect(at(279),options(at(279))).patterns.some(p=>p.anchor.index===270));
 assert.equal(detect(at(280),options(at(280))).patterns.find(p=>p.anchor.index===270).state,'DEVELOPING');
 const wet=structuredClone(s);for(const b of wet.bars)b.volume='100';assert.equal(detect(wet,options(wet)).patterns.find(p=>p.anchor.index===270).state,'WATCH');
 assert.equal(detect(s,{...options(s),rs:'70'}).patterns.find(p=>p.anchor.index===270).state,'WATCH');
 const broken=structuredClone(s);Object.assign(broken.bars.at(-1),{close:'91',low:'91'});assert.equal(detect(broken,options(broken)).patterns.find(p=>p.anchor.index===270).state,'INVALIDATED');
 const old=structuredClone(s);while(old.bars.length<361){const date=new Date(Date.UTC(2024,0,1+old.bars.length)).toISOString().slice(0,10);old.bars.push({...old.bars.at(-1),session:date,endedAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',revision:'extra-'+old.bars.length});old.sessions.push(date)}old.asOf=old.bars.at(-1).finalizedAt;
 assert.equal(detect(old,options(old)).patterns.find(p=>p.anchor.index===270).state,'EXPIRED');
});
test('primary nested selection and company/session/tick signal dedup are deterministic',()=>{
 const s=goldenSeries();const p=detect(s,options(s)).primary;
 const later={...p,id:'later',anchor:{...p.anchor,index:p.anchor.index+1}};
 assert.equal(selectPrimary([p,later]).id,'later');
 const fewer={...later,id:'fewer',legs:later.legs.slice(1)};assert.equal(selectPrimary([p,fewer]).id,p.id);
 const rows=[{companyId:'one',session:'2026-10-16',pattern:p},{companyId:'one',session:'2026-10-16',pattern:{...p,id:'secondary',pivot:'100.05'}},{companyId:'two',session:'2026-10-16',pattern:p}];
 const out=deduplicateSignals(rows,'0.05');assert.equal(out.length,2);assert.deepEqual(out[0].secondaryPatternIds,['secondary']);assert.deepEqual(deduplicateSignals([...rows].reverse(),'0.05'),out);
});
