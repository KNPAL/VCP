import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StreamOwner} from '../apps/worker/dist/stream-owner.js';
import {queue} from '../apps/worker/dist/runtime.js';
import {readLiveQuote} from '../apps/worker/dist/live-quotes.js';

test('stream owner fences competing coordinators and restores subscriptions after crash/reconnect',async()=>{
 process.env.REDIS_PORT='56379';const name='stream-test-'+randomUUID(),q=queue(name),client=await q.client;
 const listingId=randomUUID(),isin='INE000000001',base=Date.now()-1000,date=new Date(base+19800000).toISOString().slice(0,10),midnight=Date.parse(date+'T00:00:00Z')-19800000;
 const context={mapping:{id:'fixture',knownAt:'2020-01-01T00:00:00Z',sourceReference:'synthetic',rows:[{companyId:randomUUID(),listingId,isin,exchange:'NSE',series:'EQ',symbol:'TEST',instrumentType:'EQUITY',tick:'0.05',lot:1,listingDate:'2020-01-01',provider:'fixture',token:'123',validFrom:'2020-01-01',validTo:null,verified:true,enabled:true}]},session:{date,opensAt:new Date(midnight).toISOString(),closesAt:new Date(midnight+86399999).toISOString(),knownAt:new Date(midnight-86400000).toISOString(),verified:true},holdings:[isin],candidates:[],credentialRevision:'session1',credentialExpiresAt:new Date(midnight+86399999).toISOString()};
 const sockets=[],connect=async(_context,callbacks)=>{const socket={callbacks,messages:[],closed:false,send(message){this.messages.push(message)},close(){this.closed=true}};sockets.push(socket);return socket};
 const deps={context:async()=>structuredClone(context),connect},a=new StreamOwner(q,name,'fixture',10,deps),b=new StreamOwner(q,name,'fixture',10,deps);
 const frame=(sequence,time=base,token='123')=>{const f=Buffer.alloc(51);f[0]=1;f[1]=1;f.write(token,2);f.writeBigInt64LE(BigInt(sequence),27);f.writeBigInt64LE(BigInt(time),35);f.writeBigInt64LE(10005n,43);return f};
 const keys=['lease:'+name,'fence:'+name,'quotes:'+name+':connection','quotes:'+name+':'+listingId,'quotes:'+name+':'+listingId+':watermark'];
 client.defineCommand('stream_test_cleanup',{numberOfKeys:5,lua:'return redis.call("DEL",unpack(KEYS))'});
 client.defineCommand('stream_test_expire',{numberOfKeys:1,lua:'return redis.call("PEXPIRE",KEYS[1],1)'});
 try{
  await Promise.all([a.cycle(),a.cycle()]);await b.cycle();assert.equal(sockets.length,1);
  assert.ok(await client.get(keys[0]));
  // Both cycles can be invoked repeatedly without duplicate subscriptions.
  await a.cycle();await b.cycle();assert.equal(sockets[0].messages.filter(m=>m!=='ping').length,1);
  sockets[0].callbacks.frame(frame(1));await a.drained();await b.drained();assert.equal((await readLiveQuote(q,name,listingId)).state,'KNOWN');
  assert.equal((await readLiveQuote(q,name,listingId)).connectionProof,null);
  sockets[0].callbacks.pong();await a.cycle();
  const proof=(await readLiveQuote(q,name,listingId)).connectionProof;assert.equal(proof.sessionRevision,'session1');assert.ok(Date.parse(proof.heartbeatAt)>=Date.parse(proof.startedAt));assert.ok(Date.parse(proof.validUntil)>Date.now());
  sockets[0].callbacks.frame(frame(2,base-100000));await a.drained();await b.drained();assert.equal((await readLiveQuote(q,name,listingId)).quote.sequence,'1');
  await client.runCommand('stream_test_expire',[keys[0]]);await new Promise(r=>setTimeout(r,20));
  // Simulate a lost Redis counter: an old numerical fence must never become current again.
  await client.del(keys[1]);
  // A replacement takes the lease while the old process has not run its watchdog yet.
  await b.cycle();await a.cycle();
  assert.equal(sockets.length,2);assert.equal((await readLiveQuote(q,name,listingId)).state,'UNKNOWN');
  sockets[0].callbacks.frame(frame(99,base+5));await a.drained();await b.drained();assert.equal((await readLiveQuote(q,name,listingId)).state,'UNKNOWN');
  sockets[1].callbacks.frame(frame(1,base));await a.drained();await b.drained();assert.equal((await readLiveQuote(q,name,listingId)).state,'UNKNOWN');
  sockets[1].callbacks.frame(frame(1,base+1));await a.drained();await b.drained();assert.equal((await readLiveQuote(q,name,listingId)).state,'KNOWN');
  assert.equal(sockets[1].messages.filter(m=>m!=='ping').length,1);
  context.credentialRevision='session2';await b.cycle();assert.equal(sockets.length,3);assert.ok(sockets[1].closed);assert.equal((await readLiveQuote(q,name,listingId)).state,'UNKNOWN');
  sockets[2].callbacks.lost();await new Promise(r=>setTimeout(r,1100));await b.cycle();assert.equal(sockets.length,4);assert.ok(sockets[2].closed);assert.equal(sockets[3].messages.filter(m=>m!=='ping').length,1);
  // Closing the verified session removes the owner even when holdings still exist.
  context.session.closesAt=new Date(Date.now()-1).toISOString();await b.cycle();assert.equal((await readLiveQuote(q,name,listingId)).state,'UNKNOWN');assert.ok(sockets[3].closed);
 }finally{await a.stop();await b.stop();await client.runCommand('stream_test_cleanup',keys);await q.close()}
});
