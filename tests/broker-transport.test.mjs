import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerTransportAllowed} from '../apps/api/dist/broker-transport.js';
test('local broker HTTP requires explicit development mode and actual loopback transport',()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,VCP_ALLOW_LOCAL_BROKER_HTTP:process.env.VCP_ALLOW_LOCAL_BROKER_HTTP};
 const origin='http://localhost:3000',request={headers:{host:'localhost:3001',origin},socket:{remoteAddress:'127.0.0.1'}};
 try{
  process.env.NODE_ENV='development';process.env.VCP_ALLOW_LOCAL_BROKER_HTTP='true';assert.equal(brokerTransportAllowed(request,origin),true);
  for(const changed of [{...request,socket:{remoteAddress:'192.168.1.3'}},{...request,headers:{...request.headers,host:'attacker.example'}},{...request,headers:{...request.headers,origin:'http://attacker.example'}}])assert.equal(brokerTransportAllowed(changed,origin),false);
  assert.equal(brokerTransportAllowed(request,'http://remote.example'),false);
  process.env.NODE_ENV='production';assert.equal(brokerTransportAllowed(request,origin),false);assert.equal(brokerTransportAllowed({...request,secure:true},origin),true);
  process.env.NODE_ENV='development';delete process.env.VCP_ALLOW_LOCAL_BROKER_HTTP;assert.equal(brokerTransportAllowed({...request,headers:{...request.headers,'x-forwarded-proto':'https'}},origin),false);
 }finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value}
});
