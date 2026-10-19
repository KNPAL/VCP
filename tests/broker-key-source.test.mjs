import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {directoryBrokerKeys} from '../apps/worker/dist/broker-auth.js';
test('configured key source reads exact keys and rejects missing, invalid and traversal references',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vcp-key-test-'));
 try{
  const key=Buffer.alloc(32,9);await writeFile(join(directory,'test-v1.key'),key.toString('base64'));
  const load=directoryBrokerKeys(directory);assert.deepEqual(await load('test-v1'),key);
  for(const id of ['../escape','missing'])await assert.rejects(load(id),error=>error.message==='BROKER_UNAVAILABLE');
  await writeFile(join(directory,'bad.key'),'not-a-key');await assert.rejects(load('bad'),/BROKER_UNAVAILABLE/);
  assert.throws(()=>directoryBrokerKeys(''),/BROKER_UNAVAILABLE/);
 }finally{await rm(directory,{recursive:true,force:true})}
});
