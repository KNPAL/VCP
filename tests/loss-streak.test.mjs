import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lossStreak,positionEpisodes} from '../packages/portfolio/dist/index.js';
const friday='2026-10-16',asOf=friday+'T09:00:00Z';
const day=(date,kind='TRADING')=>({date,kind,opensAt:kind==='HOLIDAY'?null:date+'T04:00:00Z',closesAt:kind==='HOLIDAY'?null:date+'T10:00:00Z',finalizedAt:kind==='HOLIDAY'?null:date+'T10:05:00Z',knownAt:'2026-10-01T00:00:00Z',source:'fixture',verified:true});
const calendar=[day(friday),day('2026-10-17','HOLIDAY'),day('2026-10-18','HOLIDAY'),day('2026-10-19'),day('2026-10-20')];
function fixture(){
 const events=[];
 const add=(body,time=friday+'T06:00:00Z')=>{const e={id:randomUUID(),sequence:events.length+1,occurredAt:time,recordedAt:time,sourceId:'fixture',author:'owner',...body};events.push(e);return e};
 add({kind:'INITIAL_CAPITAL',amount:'10000',verified:true},'2026-10-01T00:00:00Z');
 const fill=(side,quantity=1,price='100',fees='0',time)=>add({kind:'FILL',isin:'INE000000001',side,quantity,price,fees,brokerReference:randomUUID()},time);
 const closed=(price='99',time)=>{const buy=fill('BUY',1,'100','0',time),sell=fill('SELL',1,price,'0',time);return {buy,sell}};
 return {events,add,fill,closed,run:(overrides={})=>lossStreak({events,calendar,asOf,source:'REAL',...overrides})};
}
test('three fully closed losses block through the next verified completed session, including holidays',()=>{
 const f=fixture();f.closed();f.closed();f.closed();const result=f.run();
 assert.equal(result.streak,3);assert.equal(result.pass,false);assert.equal(result.cooldown.session,'2026-10-19');
 assert.equal(f.run({asOf:'2026-10-19T10:04:59Z'}).state,'COOLDOWN');
 assert.equal(f.run({asOf:'2026-10-19T10:05:00Z'}).streak,0);
 assert.equal(f.run({calendar:calendar.filter(d=>d.date!=='2026-10-17')}).pass,false);
 assert.ok(f.run({calendar:null}).reasons.includes('COOLDOWN_CALENDAR_UNKNOWN'));
 assert.equal(f.run({calendar:calendar.map(d=>d.date==='2026-10-19'?{...d,finalizedAt:null}:d),asOf:'2026-10-20T06:00:00Z'}).state,'COOLDOWN');
 assert.deepEqual(f.run(),result);assert.deepEqual(f.run({events:[...f.events].reverse()}),result);
});
test('partial sales, top-ups and fees belong to one episode; zero net P&L resets',()=>{
 const f=fixture();f.fill('BUY',2,'100','1');f.fill('SELL',1,'100','0');assert.equal(f.run().streak,0);
 f.fill('BUY',1,'100','1');f.fill('SELL',2,'100','1');
 assert.equal(f.run().streak,1);assert.equal(f.run().episodes[0].netPnl,'-3.000000');
 f.closed('100');assert.equal(f.run().streak,0);assert.equal(f.run().episodes.length,2);
});
test('unassigned corporate cash cannot disappear from net P&L; explicit allocation restores exact classification',()=>{
 const f=fixture(),first=f.closed();f.closed();f.closed();const cash=f.add({kind:'CORPORATE_CREDIT',amount:'2',verified:true});
 assert.equal(f.run().state,'UNKNOWN');assert.equal(f.run().pass,null);assert.ok(f.run().unallocatedCashEventIds.includes(cash.id));
 const allocation={cashEventId:cash.id,episodeId:first.buy.id,recordedAt:cash.recordedAt};
 const result=f.run({allocations:[allocation]});assert.equal(result.pass,true);assert.equal(result.streak,2);assert.equal(result.episodes[0].netPnl,'1.000000');
 assert.throws(()=>f.run({allocations:[{...allocation,episodeId:randomUUID()}]}),/INVALID_CASH_ALLOCATION/);
 assert.throws(()=>f.run({allocations:[allocation,allocation]}),/DUPLICATE_CASH_ALLOCATION/);
});
test('corrections replay known facts without rewriting the earlier loss decision',()=>{
 const f=fixture();f.closed();f.closed();const third=f.closed(),original=f.run(),later=friday+'T09:30:00Z';
 f.add({kind:'REVERSAL',targetId:third.sell.id,reason:'correct price'},later);
 f.add({...third.sell,id:randomUUID(),sequence:f.events.length+1,recordedAt:later,price:'101',replacementOf:third.sell.id},later);
 assert.deepEqual(f.run(),original);assert.equal(f.run({asOf:later}).pass,true);assert.equal(f.run({asOf:later}).streak,0);
 assert.equal(positionEpisodes(f.events,later).episodes[2].id,third.buy.id);
});
test('late actual-fill knowledge starts cooldown when recognized; paper and actual histories stay separate',()=>{
 const f=fixture();f.closed();f.closed();const third=f.closed();third.sell.recordedAt='2026-10-19T09:00:00Z';
 assert.equal(f.run().streak,2);
 const now='2026-10-19T09:30:00Z',result=f.run({asOf:now});assert.equal(result.cooldown.session,'2026-10-20');
 const paper=f.run({events:[f.events[0]],source:'PAPER',asOf:now});assert.equal(paper.streak,0);assert.equal(paper.source,'PAPER');
});
test('closures during cooldown do not cancel it; subsequent sessions start a new streak',()=>{
 const f=fixture();f.closed();f.closed();f.closed();f.closed('110','2026-10-19T08:00:00Z');
 assert.equal(f.run({asOf:'2026-10-19T09:00:00Z'}).pass,false);
 f.closed('99','2026-10-20T06:00:00Z');assert.equal(f.run({asOf:'2026-10-20T07:00:00Z'}).streak,1);
});
