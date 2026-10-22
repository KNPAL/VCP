import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {connectSmartApiSocket} from '../apps/worker/dist/smartapi-socket.js';
class Socket extends EventEmitter {
 static instances=[];
 constructor(url,options){super();this.url=url;this.options=options;this.readyState=1;this.messages=[];Socket.instances.push(this)}
 send(message,callback){this.messages.push(message);callback()}
 terminate(){this.terminated=true;this.readyState=3;this.emit('close')}
}
const credentials={accessToken:'synthetic-access',apiKey:'synthetic-key',clientCode:'TEST123',feedToken:'synthetic-feed'};
test('SmartAPI adapter verifies TLS, bounds handshake, handles pong/binary and never reconnects itself',async()=>{
 const abort=new AbortController(),frames=[];let pongs=0,lost=0;
 const opening=connectSmartApiSocket(credentials,{frame:f=>frames.push(f),pong:()=>pongs++,lost:()=>lost++},abort.signal,Socket),ws=Socket.instances.at(-1);
 assert.equal(ws.url,'wss://smartapisocket.angelone.in/smart-stream');assert.equal(ws.options.rejectUnauthorized,true);assert.equal(ws.options.followRedirects,false);assert.equal(ws.options.handshakeTimeout,8000);assert.equal(ws.options.headers['x-feed-token'],credentials.feedToken);
 ws.emit('open');const connection=await opening;connection.send('ping');ws.emit('message',Buffer.from('pong'),false);ws.emit('pong');ws.emit('message',Buffer.alloc(51),true);assert.equal(pongs,2);assert.equal(frames.length,1);
 const count=Socket.instances.length;ws.emit('message',Buffer.from('{"error":"unauthorized"}'),false);assert.equal(lost,1);assert.ok(ws.terminated);assert.equal(Socket.instances.length,count);assert.throws(()=>connection.send('ping'),/STREAM_UNAVAILABLE/);
 ws.emit('error',new Error('synthetic-private-provider-error'));assert.equal(lost,1);connection.close();abort.abort();
});
test('aborted/invalid credentials and failed handshakes expose only sanitized errors',async()=>{
 const callbacks={frame:()=>{},pong:()=>{},lost:()=>{}},abort=new AbortController();
 for(const creds of [{},{...credentials,feedToken:'bad\r\nheader'}])await assert.rejects(connectSmartApiSocket(creds,callbacks,abort.signal,Socket),/STREAM_UNAVAILABLE/);
 const opening=connectSmartApiSocket(credentials,callbacks,abort.signal,Socket),ws=Socket.instances.at(-1);abort.abort();await assert.rejects(opening,e=>e.message==='STREAM_UNAVAILABLE');assert.ok(ws.terminated);
});
