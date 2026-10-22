import WebSocket from 'ws';
import type {StreamCallbacks,StreamSocket} from './stream-owner.js';
export interface StreamCredentials {accessToken:string;apiKey:string;clientCode:string;feedToken:string}
/** Read-only LTP transport; fixed endpoint, verified TLS, bounded handshake, no implicit reconnect. */
export function connectSmartApiSocket(credentials:StreamCredentials,callbacks:StreamCallbacks,signal:AbortSignal,Socket:typeof WebSocket=WebSocket):Promise<StreamSocket>{
 if(signal.aborted||['accessToken','apiKey','clientCode','feedToken'].some(key=>{const value=credentials[key as keyof StreamCredentials];return typeof value!=='string'||!value.trim()||value.length>16000||/[\r\n]/.test(value)}))return Promise.reject(new Error('STREAM_UNAVAILABLE'));
 return new Promise((resolve,reject)=>{
  const ws=new Socket('wss://smartapisocket.angelone.in/smart-stream',{headers:{Authorization:credentials.accessToken,'x-api-key':credentials.apiKey,'x-client-code':credentials.clientCode,'x-feed-token':credentials.feedToken},handshakeTimeout:8000,maxPayload:65536,followRedirects:false,perMessageDeflate:false,rejectUnauthorized:true});
  let opened=false,closed=false;
  const fail=()=>{if(closed)return;closed=true;signal.removeEventListener('abort',abort);ws.terminate();if(opened)callbacks.lost();else reject(new Error('STREAM_UNAVAILABLE'))};
  const abort=()=>fail();signal.addEventListener('abort',abort,{once:true});
  ws.on('error',fail);ws.on('close',fail);
  ws.on('pong',()=>{if(!closed)callbacks.pong()});
  ws.on('message',(data,isBinary)=>{
   if(closed)return;
   const bytes=Array.isArray(data)?Buffer.concat(data):data instanceof ArrayBuffer?Buffer.from(data):data;
   if(!isBinary){if(bytes.toString()==='pong')callbacks.pong();else fail();return}
   callbacks.frame(bytes);
  });
  ws.once('open',()=>{
   if(closed||signal.aborted){fail();return}opened=true;
   resolve({send:message=>{if(closed||ws.readyState!==WebSocket.OPEN)throw new Error('STREAM_UNAVAILABLE');ws.send(message,error=>{if(error)fail()})},close:()=>{if(closed)return;closed=true;signal.removeEventListener('abort',abort);ws.terminate()}});
  });
 });
}
