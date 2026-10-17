import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectPortfolio} from '../packages/portfolio/dist/index.js';
const date='2026-10-16T06:00:00Z',later='2026-10-16T07:00:00Z';
const base=n=>({id:randomUUID(),sequence:n,occurredAt:date,recordedAt:date,sourceId:'manual-'+n,author:'owner'});
const initial=()=>({...base(1),kind:'INITIAL_CAPITAL',amount:'10000',verified:true});
const fill=(n,side,quantity,price,fees='0')=>({...base(n),kind:'FILL',isin:'INE000000001',side,quantity,price,fees,brokerReference:'fill-'+n});
test('FIFO partial sales allocate all acquisition fees exactly across repeated sales',()=>{
 const events=[initial(),fill(2,'BUY',3,'100','1'),fill(3,'BUY',2,'110','2'),fill(4,'SELL',1,'120','0.1')];
 let p=projectPortfolio(events,date);assert.equal(p.cash,'9596.900000');assert.equal(p.realizedPnl,'19.566667');assert.equal(p.holdings.INE000000001,4);
 events.push(fill(5,'SELL',2,'120','0.2'));p=projectPortfolio(events,date);assert.equal(p.realizedPnl,'58.700000');assert.equal(p.lots[0].remainingFees,'0.000000');assert.equal(p.lots[1].remainingQty,2);
 assert.deepEqual(projectPortfolio(events.toReversed(),date),p);
});
test('signed funding events and missing initial capital never imply alert execution',()=>{
 assert.equal(projectPortfolio([],date).cash,null);
 const events=[initial(),{...base(2),kind:'DEPOSIT',amount:'100',verified:true},{...base(3),kind:'WITHDRAWAL',amount:'50',verified:true},{...base(4),kind:'DIVIDEND',amount:'10',verified:true}];
 const p=projectPortfolio(events,date);assert.equal(p.cash,'10060.000000');assert.deepEqual(p.holdings,{});
 assert.throws(()=>projectPortfolio([fill(1,'BUY',1,'10')],date),/INITIAL/);
 assert.throws(()=>projectPortfolio([initial(),{...initial(),...base(2)}],date),/INITIAL/);
 assert.throws(()=>projectPortfolio([initial(),{...base(2),kind:'DIVIDEND',amount:'10',verified:false}],date),/UNVERIFIED/);
});
test('corrections retain facts, reverse cash, replace FIFO and obey knowledge time',()=>{
 const buy=fill(2,'BUY',3,'100','1'),sell=fill(3,'SELL',1,'120');const before=[initial(),buy,sell];
 const reversal={...base(4),occurredAt:later,recordedAt:later,kind:'REVERSAL',targetId:buy.id,reason:'Correct execution price'};
 const replacement={...buy,id:randomUUID(),sequence:5,recordedAt:later,replacementOf:buy.id,price:'101'};
 const history=[...before,reversal,replacement];const original=projectPortfolio(before,date);
 assert.deepEqual(projectPortfolio(history,date),original);
 const corrected=projectPortfolio(history,later);assert.equal(corrected.cash,'9816.000000');assert.equal(corrected.realizedPnl,'18.666667');assert.equal(corrected.holdings.INE000000001,2);assert.equal(history[1].price,'100');
 assert.throws(()=>projectPortfolio([...history,{...reversal,...base(6),recordedAt:later}],later),/REVERSAL/);
});
test('oversells, zero quantities, duplicate source fills and invalid corrections fail',()=>{
 assert.throws(()=>projectPortfolio([initial(),fill(2,'SELL',1,'100')],date),/SELL_EXCEEDS/);
 assert.throws(()=>projectPortfolio([initial(),fill(2,'BUY',0,'100')],date),/INVALID_FILL/);
 const buy=fill(2,'BUY',1,'100');assert.throws(()=>projectPortfolio([initial(),buy,{...buy,...base(3)}],date),/DUPLICATE_BROKER/);
 assert.throws(()=>projectPortfolio([initial(),{...buy,replacementOf:randomUUID()}],date),/REVERSAL/);
});
