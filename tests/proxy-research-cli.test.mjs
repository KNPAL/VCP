import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {goldenSeries} from '../fixtures/vcp-golden.mjs';
import {smeEvidence} from '../fixtures/sme-research.mjs';
test('research CLI enforces source registry permission, freshness and coverage before deriving',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vcp-proxy-'));
 try{
  const series=goldenSeries(),asOf=series.asOf,source={...smeEvidence(asOf).source,coverage:{intended:series.bars.length,available:series.bars.length}},path=join(directory,'reviewed.json');
  const run=async change=>{await writeFile(path,JSON.stringify({source:{...source,...change},series}));const processResult=spawnSync(process.execPath,['scripts/proxy-research.mjs',path,asOf],{encoding:'utf8'});assert.equal(processResult.status,0,processResult.stderr);return JSON.parse(processResult.stdout)};
  const observed=await run({});assert.notEqual(observed.state,'UNKNOWN');assert.match(observed.inputHash,/^[a-f0-9]{64}$/);assert.equal(observed.executable,false);assert.equal(observed.broaderProxy.state,'UNKNOWN');
  for(const change of [{uses:{...source.uses,DISPLAY:false}},{uses:{...source.uses,DERIVE:null}},{validUntil:asOf},{coverage:{intended:310,available:0}},{licenseRef:null},{asOf:new Date(Date.parse(asOf)-1000).toISOString()}]){const result=await run(change);assert.equal(result.state,'UNKNOWN');assert.equal(result.prior100High,null);assert.equal(result.dataRevision,null);assert.equal(result.buyEligible,false)}
 }finally{await rm(directory,{recursive:true,force:true})}
});
