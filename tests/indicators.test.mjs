import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sma,ema21,trueRange,atr14,natr,atrCompression,vdu,rvol,range52,trendTemplate,relativeStrength,percentiles,marketRegime,adv20,sectorContext,Q} from '../packages/indicators/dist/index.js';
// Synthetic consecutive sessions deliberately declared explicitly; no exchange calendar inferred.
function series(n,value=100){const bars=Array.from({length:n},(_,i)=>{const date=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);const c=typeof value==='function'?value(i):value;return {session:date,open:String(c),high:String(c+1),low:String(c-1),close:String(c),volume:'100',revision:'r'+i,finalizedAt:date+'T10:30:00Z',adjustmentVerified:true}});return {bars,sessions:bars.map(b=>b.session),asOf:'2026-10-17T00:00:00Z',dataRevision:'synthetic-v1'}}
test('SMA and EMA warmup, seed, recurrence and gap protection',()=>{
 assert.equal(sma(series(20,i=>i+100),20).value,'109.50000000');
 assert.equal(ema21(series(21,i=>i+100)).value,'110.00000000');
 assert.equal(ema21(series(22,i=>i+100)).value,'111.00000000');
 assert.equal(ema21(series(20)).state,'UNKNOWN');
 const s=series(21);s.bars.splice(10,1);assert.equal(ema21(s).state,'UNKNOWN');
 const unfinished=series(21);unfinished.bars[20].finalizedAt=null;assert.equal(ema21(unfinished).state,'UNKNOWN');
 const future=series(21);future.asOf='2024-01-10T00:00:00Z';assert.equal(ema21(future).state,'UNKNOWN');
});
test('TR uses prior close and Wilder ATR requires 14 valid TR values',()=>{
 assert.equal(atr14(series(14)).state,'UNKNOWN');assert.equal(atr14(series(15)).value,'2.00000000');
 const s=series(16);Object.assign(s.bars[15],{open:'110',high:'111',low:'109',close:'110'});
 assert.equal(trueRange(s).value,'11.00000000');
 assert.equal(atr14(s).value,new Q(37,14).fixed());
 assert.equal(natr(series(15)).value,'2.00000000');
 assert.equal(atrCompression(series(35)).value,'1.00000000');
 assert.equal(atrCompression(series(34)).state,'UNKNOWN');
});
test('VDU includes current volume while RVOL baseline excludes it',()=>{
 const s=series(51);s.bars[50].volume='200';assert.equal(rvol(s).value,'2.00000000');
 assert.equal(rvol(series(50)).state,'UNKNOWN');
 assert.equal(rvol(s,20).value,'2.00000000');
 const dry=series(20);for(const b of dry.bars.slice(-5))b.volume='50';assert.equal(vdu(dry).value,new Q(4,7).fixed());
 const zero=series(51);for(const b of zero.bars)b.volume='0';assert.equal(rvol(zero).state,'UNKNOWN');assert.equal(vdu(zero).state,'UNKNOWN');
});
test('252-session extrema and strict ten predicates include the 30-session SMA lag',()=>{
 assert.equal(range52(series(251)).state,'UNKNOWN');
 assert.deepEqual(range52(series(252)).value,{high:'101.00000000',low:'99.00000000'});
 const up=series(260,i=>100+i);assert.equal(trendTemplate(up,'80').value.state,'PASS');
 assert.equal(trendTemplate(up,'70').value.predicates[9],'FAIL');
 assert.equal(trendTemplate(up,'79.99999999').value.buyStrength,'FAIL');
 assert.equal(trendTemplate(up,null).value.state,'UNKNOWN');
 assert.equal(trendTemplate(series(229,i=>100+i),'80').value.predicates[6],'UNKNOWN');
});
test('RS aligns all session dates and excludes unavailable warmup',()=>{
 const s=series(251);const b=series(251);assert.equal(relativeStrength(s,b).value.raw,'0.00000000');
 Object.assign(s.bars[250],{open:'200',high:'201',low:'199',close:'200'});assert.equal(relativeStrength(s,b).value.raw,'1.00000000');
 assert.equal(relativeStrength(series(250),series(250)).state,'UNKNOWN');
 b.sessions[0]='2023-12-31';assert.equal(relativeStrength(s,b).state,'UNKNOWN');
});
test('RS midpoint ties, ISIN deduplication and exact 80 percent coverage',()=>{
 const members=['a','b','c','d','e'];const rows=['a','b','c','d'].map(isin=>({isin,value:'0'}));
 assert.equal(percentiles(members,rows).values.a,'50.00000000');
 assert.equal(percentiles(members,rows.slice(0,3)).state,'UNKNOWN');
 assert.equal(percentiles(['a','a','b'],[{isin:'a',value:'0'},{isin:'a',value:'0'},{isin:'b',value:'1'}]).values.a,'25.00000000');
 assert.equal(percentiles(['a'],[{isin:'a',value:null}]).state,'UNKNOWN');
});
test('market score respects strict comparisons, regime boundaries and coverage',()=>{
 const members=Array.from({length:8},(_,i)=>String(i));
 const rows=n=>members.map((isin,i)=>({isin,close:i<n?'101':'100',sma50:'100'}));
 assert.equal(marketRegime('101','100','99',members,rows(3)).score,'7.50000000');
 assert.equal(marketRegime('101','100','99',members,rows(3)).regime,'GREEN');
 assert.equal(marketRegime('101','100','100',members,rows(3)).regime,'YELLOW');
 assert.equal(marketRegime('100','100','100',members,rows(8)).regime,'RED');
 assert.equal(marketRegime(null,'100','99',members,rows(8)).regime,'UNKNOWN');
 assert.equal(marketRegime('101','100','99',members,rows(8).slice(0,6)).multiplier,'0');
});
test('ADV uses median raw turnover, exact floor and unknown sector context',()=>{
 const s={...series(20),priceScale:'RAW'};for(const b of s.bars)b.volume='2000000';
 assert.equal(adv20(s).value.eligible,true);s.bars[19].volume='999999999';assert.equal(adv20(s).value.median,'200000000.000000');
 assert.equal(adv20({...series(19),priceScale:'RAW'}).state,'UNKNOWN');assert.equal(adv20(series(20)).state,'UNKNOWN');assert.equal(sma(s,20).state,'UNKNOWN');
 assert.equal(sectorContext(null,'0').state,'UNKNOWN');assert.equal(sectorContext(['0.1','0.3'],'0.1').value,'0.10000000');
});

