import {HttpException} from '@nestjs/common';
import type {AuthRequest} from './auth.js';
export type BrokerRequest=AuthRequest&{secure?:boolean;socket?:{remoteAddress?:string}};
const loopback=(value:string|undefined)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value??'');
/** Explicit development-only exception; forwarded headers cannot enable it. */
export function brokerTransportAllowed(request:BrokerRequest,origin:string){
 if(request.secure)return true;
 if(process.env['NODE_ENV']!=='development'||process.env['VCP_ALLOW_LOCAL_BROKER_HTTP']!=='true'||!loopback(request.socket?.remoteAddress))return false;
 try{
  const app=new URL(origin),host=request.headers['host'];
  if(app.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(app.hostname)||typeof host!=='string')return false;
  const destination=new URL('http://'+host);
  return ['localhost','127.0.0.1','[::1]'].includes(destination.hostname)&&(!request.headers['origin']||request.headers['origin']===origin);
 }catch{return false}
}
export function requireBrokerTransport(request:BrokerRequest,origin:string){if(!brokerTransportAllowed(request,origin))throw new HttpException('BROKER_HTTPS_REQUIRED',403)}
