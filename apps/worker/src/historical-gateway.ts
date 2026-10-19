import {brokerCircuitStore,resolveBrokerSession,type BrokerKeyResolver,type PrismaClient} from '@vcp/database';
import {historicalRequest,historicalTransport,normalizeHistoricalResponse,verifiedCalendar,type CalendarDay,type InstrumentSnapshot,type BrokerSecrets,type HistoricalWindow,type BackfillWindow} from '@vcp/market-data';
import type {Queue} from 'bullmq';
import {reserveBrokerBudget,type ObservedQuota} from './broker-budget.js';
/** Internal worker service. Secrets come from the credential adapter, never request/UI parameters. */
export function requestHistoricalWindow(db:PrismaClient,q:Queue,input:{accountKey:string;sessionRevision:string;staticIpVerified:boolean;downloadAllowed:boolean;window:HistoricalWindow;secrets:BrokerSecrets;observedQuota?:ObservedQuota}){
 return historicalRequest(input,{
  ...brokerCircuitStore(db,input.accountKey),
  acquireBudget:()=>reserveBrokerBudget(q,input.accountKey,input.observedQuota),
  send:historicalTransport(input.window,input.secrets),
 });
}
export class HistoricalWindowError extends Error {
 constructor(readonly reason:'BROKER_UNAVAILABLE'|'INVALID_BROKER_RESPONSE'|'BROKER_RESPONSE_SCOPE_MISMATCH'|'RATE_LIMITED',readonly retryAfterMs=1000){super(reason)}
}
/** Internal adapter: the request callback is the budgeted gateway, never a raw HTTP client. */
export function normalizedHistoricalGateway(input:{listingId:string;exchange:'NSE'|'BSE';symbolToken:string;mapping:InstrumentSnapshot|null;calendar:readonly CalendarDay[];now:()=>string;request:(window:HistoricalWindow)=>Promise<Awaited<ReturnType<typeof historicalRequest>>>}){
 return {now:input.now,fetch:async(window:BackfillWindow)=>{
  const before=input.now(),calendar=verifiedCalendar(input.calendar,window.from,window.to,before);
  if(calendar.state!=='KNOWN'||JSON.stringify(calendar.sessions.map(day=>day.date))!==JSON.stringify(window.sessions))throw new HistoricalWindowError('BROKER_RESPONSE_SCOPE_MISMATCH');
  const request={exchange:input.exchange,symbolToken:input.symbolToken,from:window.from,to:window.to};
  // Validate source identity before using the account's quota or network.
  const identity=normalizeHistoricalResponse({...input,request,receivedAt:before,rows:[]});
  if(identity.status==='UNKNOWN')throw new HistoricalWindowError('BROKER_RESPONSE_SCOPE_MISMATCH');
  const result=await input.request(request);
  if(result.state!=='KNOWN')throw new HistoricalWindowError(result.reason==='RATE_LIMITED'?'RATE_LIMITED':'BROKER_UNAVAILABLE',Math.min(86400000,Math.max(1000,result.retryAfterMs??1000)));
  const response=normalizeHistoricalResponse({...input,request,receivedAt:input.now(),rows:result.data});
  if(response.status==='UNKNOWN'||response.malformed.length||response.quarantined.length)throw new HistoricalWindowError('INVALID_BROKER_RESPONSE');
  // Missing sessions are intentional: transactional ingestion records gaps and subdivides the range.
  return response.bars;
 }};
}
export function brokerBackfillGateway(db:PrismaClient,q:Queue,input:Omit<Parameters<typeof requestHistoricalWindow>[2],'window'> & Omit<Parameters<typeof normalizedHistoricalGateway>[0],'request'>){
 return normalizedHistoricalGateway({...input,request:window=>requestHistoricalWindow(db,q,{...input,window})});
}
/** Queue/run configuration carries only a reference; decrypt immediately before each bounded window. */
export function referencedBrokerBackfillGateway(db:PrismaClient,q:Queue,input:Omit<Parameters<typeof normalizedHistoricalGateway>[0],'request'>&{reference:string;loadKey:BrokerKeyResolver;downloadAllowed:boolean;observedQuota?:ObservedQuota}){
 return {now:input.now,fetch:async(window:BackfillWindow)=>{
  try{const session=await resolveBrokerSession(db,input.reference,input.loadKey,input.now());return await brokerBackfillGateway(db,q,{...input,...session}).fetch(window)}catch(error){if(error instanceof HistoricalWindowError)throw error;throw new HistoricalWindowError('BROKER_UNAVAILABLE')}
 }};
}
