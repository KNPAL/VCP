import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {encryptBrokerConfiguration,decryptBrokerConfiguration,validateBrokerConfiguration} from '../packages/database/dist/broker-configuration-vault.js';
test('configuration encryption binds owner and revision and fails closed on tampering',()=>{
 const owner=randomUUID(),revision=randomUUID(),key=randomBytes(32),input={apiKey:'synthetic-configuration-secret',clientCode:'ab1234'},envelope=encryptBrokerConfiguration(owner,revision,input,key);
 assert.deepEqual(decryptBrokerConfiguration(owner,revision,envelope,key),{...input,clientCode:'AB1234'});assert.ok(!JSON.stringify(envelope).includes(input.apiKey));
 for(const run of [()=>decryptBrokerConfiguration(randomUUID(),revision,envelope,key),()=>decryptBrokerConfiguration(owner,randomUUID(),envelope,key),()=>decryptBrokerConfiguration(owner,revision,envelope,randomBytes(32)),()=>decryptBrokerConfiguration(owner,revision,{...envelope,tag:randomBytes(16).toString('base64')},key)])assert.throws(run,/UNAVAILABLE/);
 for(const value of [{...input,pin:'1234'},{...input,totp:'123456'},{...input,apiKey:'bad\r\nkey'},{...input,clientCode:'x'},null])assert.throws(()=>validateBrokerConfiguration(value),/INVALID/);
});
