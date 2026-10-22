import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {encryptBrokerCredentials,decryptBrokerCredentials} from '../packages/market-data/dist/index.js';
const binding={reference:randomUUID(),accountKey:'a'.repeat(64),sessionRevision:randomUUID(),keyId:'test-v1',expiresAt:'2026-10-19T00:00:00Z'};
const secrets={accessToken:'synthetic-token-never-log',apiKey:'synthetic-key',clientLocalIp:'127.0.0.1',clientPublicIp:'192.0.2.1',macAddress:'00:00:00:00:00:00'};
const now='2026-10-18T12:00:00Z';
test('broker encryption uses independent nonces and round trips exact credentials',()=>{
 const key=randomBytes(32),one=encryptBrokerCredentials(binding,secrets,key),two=encryptBrokerCredentials(binding,secrets,key);
 assert.notEqual(one.iv,two.iv);assert.notEqual(one.ciphertext,two.ciphertext);assert.ok(!JSON.stringify(one).includes(secrets.accessToken));assert.deepEqual(decryptBrokerCredentials(binding,one,key,now),secrets);
});
test('feed token and verified client identity are encrypted together; partial stream credentials are rejected',()=>{
 const key=randomBytes(32),stream={...secrets,clientCode:'TEST123',feedToken:'synthetic-feed-token'};
 const envelope=encryptBrokerCredentials(binding,stream,key);assert.deepEqual(decryptBrokerCredentials(binding,envelope,key,now),stream);assert.ok(!JSON.stringify(envelope).includes(stream.feedToken));
 assert.throws(()=>encryptBrokerCredentials(binding,{...secrets,feedToken:stream.feedToken},key),/BROKER_UNAVAILABLE/);
 assert.throws(()=>encryptBrokerCredentials(binding,{...stream,feedToken:'bad\r\nheader'},key),/BROKER_UNAVAILABLE/);
});
test('wrong keys, altered ciphertext and changed identity metadata fail with sanitized errors',()=>{
 const key=randomBytes(32),envelope=encryptBrokerCredentials(binding,secrets,key);
 const fail=fn=>assert.throws(fn,error=>error.message==='BROKER_UNAVAILABLE'&&!error.message.includes(secrets.accessToken));
 fail(()=>decryptBrokerCredentials(binding,envelope,randomBytes(32),now));
 for(const patch of [{reference:randomUUID()},{accountKey:'b'.repeat(64)},{sessionRevision:randomUUID()},{keyId:'test-v2'},{expiresAt:'2026-10-20T00:00:00Z'}])fail(()=>decryptBrokerCredentials({...binding,...patch},envelope,key,now));
 const bytes=Buffer.from(envelope.ciphertext,'base64');bytes[0]^=1;fail(()=>decryptBrokerCredentials(binding,{...envelope,ciphertext:bytes.toString('base64')},key,now));
 fail(()=>decryptBrokerCredentials(binding,{...envelope,tag:'bad'},key,now));
});
test('expired sessions, short keys, injected headers and extra secret fields are refused',()=>{
 const key=randomBytes(32),envelope=encryptBrokerCredentials(binding,secrets,key);
 assert.throws(()=>decryptBrokerCredentials(binding,envelope,key,binding.expiresAt),/BROKER_UNAVAILABLE/);
 assert.throws(()=>encryptBrokerCredentials(binding,secrets,randomBytes(16)),/BROKER_UNAVAILABLE/);
 assert.throws(()=>encryptBrokerCredentials(binding,{...secrets,accessToken:'bad\r\nheader'},key),/BROKER_UNAVAILABLE/);
 assert.throws(()=>encryptBrokerCredentials(binding,{...secrets,password:'unused'},key),/BROKER_UNAVAILABLE/);
});
