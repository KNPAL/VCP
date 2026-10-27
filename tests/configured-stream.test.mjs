import test from 'node:test';
import assert from 'node:assert/strict';
import {ConfiguredStream} from '../apps/worker/dist/configured-stream.js';
test('saved account changes stop the old stream before replacement; unavailable routing stops monitoring',async()=>{
 let account='first',fail=false;const events=[];
 const manager=new ConfiguredStream(async()=>{if(fail)throw new Error('storage unavailable');return account},value=>({cycle:async()=>{events.push('cycle:'+value)},stop:async()=>{events.push('stop:'+value)}}));
 await Promise.all([manager.cycle(),manager.cycle()]);assert.deepEqual(events,['cycle:first']);
 account='second';await manager.cycle();assert.deepEqual(events,['cycle:first','stop:first','cycle:second']);
 account=undefined;await manager.cycle();assert.equal(events.at(-1),'stop:second');
 account='second';await manager.cycle();fail=true;await manager.cycle();assert.equal(events.at(-1),'stop:second');
 fail=false;await manager.cycle();await manager.stop();const count=events.length;await manager.cycle();assert.equal(events.length,count);
});
test('stop during routing lookup cannot create a new stream',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r});let created=0;
 const manager=new ConfiguredStream(()=>pending,()=>{created++;return {cycle:async()=>{},stop:async()=>{}}});const cycle=manager.cycle(),stopped=manager.stop();resolve('account');await Promise.all([cycle,stopped]);assert.equal(created,0);
});
