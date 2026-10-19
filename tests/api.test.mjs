import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, StrictObjectPipe } from '../apps/api/dist/app.js';
test('API starts and uses versioned routes and typed failures', async () => {
  const logs=[];const app = await createApp({logSink:line=>logs.push(JSON.parse(line))});
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(base+'/api/v1/system/health');
    assert.equal(response.status,200);
    const health = await response.json();
    assert.equal(health.status,'UP');
    assert.equal(health.strategyVersion,'ST_VCP_4_0');
    assert.ok(Number.isFinite(Date.parse(health.at)));
    const missing = await fetch(base+'/system/health');
    assert.equal(missing.status,404);
    const error = await missing.json();
    assert.equal(error.error.code,'NOT_FOUND');
    assert.equal(error.error.requestId, missing.headers.get('x-request-id'));
    assert.equal(error.error.details,null);
    const spec = await (await fetch(base+'/api/v1/system/openapi.json')).json();
    assert.equal(spec.openapi,'3.1.0');
    assert.ok(spec.paths['/api/v1/system/health']);
    const unsupported = await fetch(base+'/api/v1/system/health',{method:'POST'});
    assert.equal(unsupported.status,404);
    const secret='private-token-do-not-log';const failed=await fetch(base+'/api/v1/positions?access_token='+secret,{headers:{authorization:'Bearer '+secret,cookie:'vcp_session='+secret,'x-request-id':secret}});
    assert.equal(failed.status,401);const failedBody=await failed.json();const requestId=failed.headers.get('x-request-id');assert.notEqual(requestId,secret);assert.equal(failedBody.error.requestId,requestId);
    const traced=logs.filter(row=>row.requestId===requestId);assert.equal(traced.length,2);assert.equal(traced[1].httpStatus,401);assert.equal(traced[1].result,'FAILED');assert.ok(!JSON.stringify(logs).includes(secret));
  } finally { await app.close(); }
});
test('strict DTO rejects arrays, null, unknown properties and wrong field types', () => {
  const pipe = new StrictObjectPipe({count: v => Number.isSafeInteger(v) && v >= 0});
  for (const value of [null, [], {count:1, surprise:true}, {count:'1'}, {}]) assert.throws(() => pipe.transform(value));
  assert.deepEqual(pipe.transform({count:0}),{count:0});
});
