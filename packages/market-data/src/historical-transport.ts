import {sessionDate} from '@vcp/domain';
export interface BrokerSecrets {accessToken:string;apiKey:string;clientLocalIp:string;clientPublicIp:string;macAddress:string;clientCode?:string;feedToken?:string}
export interface HistoricalWindow {exchange:'NSE'|'BSE';symbolToken:string;from:string;to:string}
export const HISTORICAL_ENDPOINT='https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData';
/** Only this fixed read-only endpoint is exposed. Redirects cannot forward broker secrets. */
export function historicalTransport(window:HistoricalWindow,secrets:BrokerSecrets,fetcher:typeof fetch=fetch){
 sessionDate(window.from);sessionDate(window.to);
 if(!['NSE','BSE'].includes(window.exchange)||!/^\d+$/.test(window.symbolToken)||window.from>window.to||(new Date(window.to).valueOf()-new Date(window.from).valueOf())/86400000+1>400)throw new Error('INVALID_HISTORICAL_WINDOW');
 if((['accessToken','apiKey','clientLocalIp','clientPublicIp','macAddress'] as const).some(key=>typeof secrets[key]!=='string'||!secrets[key].trim()||/[\r\n]/.test(secrets[key])))throw new Error('BROKER_CREDENTIALS_INVALID');
 return async(signal:AbortSignal)=>{
  const response=await fetcher(HISTORICAL_ENDPOINT,{
   method:'POST',redirect:'error',signal,
   headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Bearer '+secrets.accessToken,'X-PrivateKey':secrets.apiKey,'X-ClientLocalIP':secrets.clientLocalIp,'X-ClientPublicIP':secrets.clientPublicIp,'X-MACAddress':secrets.macAddress,'X-UserType':'USER','X-SourceID':'WEB'},
   body:JSON.stringify({exchange:window.exchange,symboltoken:window.symbolToken,interval:'ONE_DAY',fromdate:window.from+' 00:00',todate:window.to+' 23:59'}),
  });
  const reader=response.body?.getReader(),decoder=new TextDecoder();let body='',size=0;
  if(reader)try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>8_000_000){await reader.cancel();body='null';break}body+=decoder.decode(chunk.value,{stream:true})}body+=decoder.decode()}finally{reader.releaseLock()}
  const header=response.headers.get('retry-after');
  const retryAfterMs=header&&/^\d+$/.test(header)?Number(header)*1000:header?Math.max(0,Date.parse(header)-Date.now()):0;
  return {status:response.status,contentType:response.headers.get('content-type')??'',body,retryAfterMs:Number.isFinite(retryAfterMs)?retryAfterMs:0};
 };
}
