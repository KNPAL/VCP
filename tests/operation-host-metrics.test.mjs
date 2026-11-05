import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {operationHostMetrics} from '../apps/api/dist/operation-host-metrics.js';
test('operations host metrics distinguish unreadable, invalid, failed and recovered backup evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vcp-operations-')),receipt=join(dir,'backup.json'),env={VCP_MONITORED_VOLUME:dir,VCP_BACKUP_STATUS_FILE:receipt};
 try{
  assert.equal((await operationHostMetrics(env)).backup,null);
  await writeFile(receipt,'{broken');assert.equal((await operationHostMetrics(env)).backup,null);
  const completedAt=new Date(Date.now()-1000).toISOString();
  for(const state of ['FAILED','SUCCESS']){
   await writeFile(receipt,JSON.stringify({state,completedAt}));
   const result=await operationHostMetrics(env);
   assert.deepEqual(result.backup,{state,completedAt});
   assert.ok(result.disk.freePercent>=0&&result.disk.freePercent<=100);
  }
  await writeFile(receipt,JSON.stringify({state:'SUCCESS',completedAt:new Date(Date.now()+60000).toISOString()}));
  assert.equal((await operationHostMetrics(env)).backup,null);
 }finally{await rm(receipt,{force:true});await import('node:fs/promises').then(fs=>fs.rmdir(dir))}
});
