import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {trace,withLogContext,writeLog,logContext} from '../packages/domain/dist/logging.js';
test('nested async operations retain correlation and isolate concurrent requests',async()=>{
 const lines=[],ids=[randomUUID(),randomUUID()];
 await Promise.all(ids.map(id=>withLogContext({requestId:id,sink:line=>lines.push(JSON.parse(line))},()=>trace('worker.job',async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(logContext().requestId,id);return trace('broker.history',async()=>({dataRevision:'a'.repeat(64)}))}))));
 for(const id of ids){const records=lines.filter(row=>row.correlationId===id);assert.equal(records.length,4);assert.ok(records.every(row=>row.requestId===id));assert.equal(new Set(records.map(row=>row.spanId)).size,2);assert.ok(records.filter(row=>row.finishedAt).every(row=>row.dataRevision==='a'.repeat(64)))}
});
test('closed log schema omits secret fields and sanitizes raw failures and identifiers',async()=>{
 const lines=[],secret='Bearer token-secret-value';
 await withLogContext({requestId:secret,jobIdentity:secret,sink:line=>lines.push(line)},async()=>{
  await assert.rejects(trace('broker.auth',async()=>{throw new Error(secret)}));
  writeLog('api.request',{startedAt:new Date().toISOString(),finishedAt:null,result:'FAILED',failureCode:secret,dataRevision:secret,headers:{Authorization:secret},cookie:secret,body:{password:secret}}, {correlationId:secret,requestId:secret,spanId:secret,jobId:secret});
 });
 assert.ok(lines.every(line=>!line.includes(secret)));assert.equal(JSON.parse(lines[1]).failureCode,'INTERNAL_ERROR');assert.equal(JSON.parse(lines[2]).requestId,null);
});
test('unknown outcomes remain explicit and a broken log sink does not alter evaluation',async()=>{
 const lines=[];await withLogContext({sink:line=>lines.push(JSON.parse(line))},()=>trace('feed',async()=>({state:'UNKNOWN',reason:'BROKER_UNAVAILABLE'})));
 assert.equal(lines.at(-1).result,'UNKNOWN');assert.equal(lines.at(-1).failureCode,'BROKER_UNAVAILABLE');
 assert.equal(await withLogContext({sink:()=>{throw new Error('sink down')}},()=>trace('alert.delivery',async()=>42)),42);
});
