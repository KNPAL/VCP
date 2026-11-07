import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
const next=createRequire(new URL('../apps/web/package.json',import.meta.url))('next');
const dir=fileURLToPath(new URL('../apps/web/',import.meta.url));
const port=Number(process.env.VCP_WEB_PORT??process.env.PORT??3000),hostname=process.env.WEB_HOST??'127.0.0.1';
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Invalid web port');
const upstream=new URL(process.env.API_INTERNAL_URL??'http://127.0.0.1:3001');
if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password||upstream.pathname!=='/')throw new Error('Invalid API origin');
const app=next({dev:false,dir,hostname,port});await app.prepare();
// Resolve the API at startup; Next's compiled rewrites retain the build-time port.
const handler=app.getRequestHandler(),server=createServer((req,res)=>{
 if(!req.url?.startsWith('/api/v1/')){void handler(req,res);return}
 const proxy=(upstream.protocol==='https:'?httpsRequest:httpRequest)(new URL(req.url,upstream),{method:req.method,headers:{...req.headers,host:upstream.host}},response=>{
  res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
 });
 proxy.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'API_UNAVAILABLE'}}))}else res.destroy()});
 req.on('aborted',()=>proxy.destroy());res.on('close',()=>{if(!res.writableFinished)proxy.destroy()});req.pipe(proxy);
});
const tunnels=new Set();
server.on('upgrade',(req,socket,head)=>{
 if(!req.url?.startsWith('/api/v1/socket.io/?')||req.headers.upgrade?.toLowerCase()!=='websocket'){socket.destroy();return}
 const request=(upstream.protocol==='https:'?httpsRequest:httpRequest)(new URL(req.url,upstream),{method:'GET',headers:{...req.headers,host:upstream.host},timeout:10000});
 request.on('upgrade',(response,remote,remoteHead)=>{
  remote.setTimeout(0);
  const headers=['HTTP/1.1 101 Switching Protocols'];
  for(const [name,value] of Object.entries(response.headers))if(value!==undefined)headers.push(name+': '+(Array.isArray(value)?value.join(', '):value));
  socket.write(headers.join('\r\n')+'\r\n\r\n');
  if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
  tunnels.add(socket);tunnels.add(remote);
  socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());
  socket.on('close',()=>{tunnels.delete(socket);remote.destroy()});remote.on('close',()=>{tunnels.delete(remote);socket.destroy()});
  socket.pipe(remote);remote.pipe(socket);
 });
 request.on('response',response=>{response.resume();socket.destroy()});
 request.on('timeout',()=>request.destroy());request.on('error',()=>socket.destroy());socket.on('error',()=>request.destroy());request.end();
});
server.listen(port,hostname);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;for(const socket of tunnels)socket.destroy();await new Promise(resolve=>server.close(resolve));await app.close()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
