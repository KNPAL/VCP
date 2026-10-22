import {exchangeDate,utcInstant,parseFixed} from '@vcp/domain';
import {canonicalListings,validateInstrumentSnapshot,type InstrumentSnapshot} from './instruments.js';
import type {ProviderTick} from './live-quotes.js';

export interface StreamCandidate {isin:string;state:'READY'|'WATCH';distanceToPivot:string;pivot?:string;validUntil:string}
export interface StreamSubscription {listingId:string;isin:string;exchange:'NSE'|'BSE';token:string;priority:'HOLDING'|'READY'|'WATCH'}
/** Holdings consume capacity first. No caller-supplied broker tokens are trusted. */
export function planStreamSubscriptions(input:{holdings:readonly string[];candidates:readonly StreamCandidate[];mapping:InstrumentSnapshot|null;provider:string;asOf:string;capacity:number}){
 const at=utcInstant(input.asOf).valueOf(),date=exchangeDate(input.asOf);
 if(!Number.isSafeInteger(input.capacity)||input.capacity<1||input.capacity>1000)throw new Error('INVALID_STREAM_CAPACITY');
 const rejected:{isin:string;reason:string}[]=[],subscriptions:StreamSubscription[]=[],seen=new Set<string>(),tokens=new Set<string>();
 const ranked=input.candidates.filter(c=>{try{return ['READY','WATCH'].includes(c.state)&&utcInstant(c.validUntil).valueOf()>at&&parseFixed(c.distanceToPivot)>=0n&&parseFixed(c.pivot??'1')>0n}catch{return false}}).sort((a,b)=>{
  const priority=(a.state==='READY'?0:1)-(b.state==='READY'?0:1),left=parseFixed(a.distanceToPivot)*parseFixed(b.pivot??'1'),right=parseFixed(b.distanceToPivot)*parseFixed(a.pivot??'1');
  return priority||(left<right?-1:left>right?1:0)||a.isin.localeCompare(b.isin);
 });
 const wanted:{isin:string;priority:StreamSubscription['priority']}[]=[...[...new Set(input.holdings)].sort().map(isin=>({isin,priority:'HOLDING' as const})),...ranked.map(c=>({isin:c.isin,priority:c.state}))];
 let mapping=input.mapping;
 try{if(mapping){validateInstrumentSnapshot(mapping);if(utcInstant(mapping.knownAt).valueOf()>at)mapping=null}}catch{mapping=null}
 for(const item of wanted){
  if(seen.has(item.isin))continue;seen.add(item.isin);
  const listing=canonicalListings(mapping?[mapping]:[],[item.isin],input.asOf)[0]?.primary;
  if(!listing||listing.provider!==input.provider){rejected.push({isin:item.isin,reason:'TOKEN_MAPPING_UNAVAILABLE'});continue}
  const tokenKey=listing.exchange+'|'+listing.token;
  // A provider token must identify exactly one effective listing, including mappings outside the desired set.
  if(mapping!.rows.filter(r=>r.provider===input.provider&&r.exchange===listing.exchange&&r.token===listing.token&&r.validFrom<=date&&(r.validTo===null||date<r.validTo)).length!==1||tokens.has(tokenKey)){rejected.push({isin:item.isin,reason:'AMBIGUOUS_TOKEN'});continue}
  if(subscriptions.length>=input.capacity){rejected.push({isin:item.isin,reason:'STREAM_CAPACITY_EXCEEDED'});continue}
  tokens.add(tokenKey);subscriptions.push({listingId:listing.listingId,isin:item.isin,exchange:listing.exchange,token:listing.token,priority:item.priority});
 }
 return {subscriptions,rejected,asOf:input.asOf,mappingRevision:mapping?.id??null,executable:false as const};
}

/** SmartAPI V2 LTP cash-equity frame. Preserve int64 prices and sequence as strings. */
export function decodeSmartApiLtp(frame:Uint8Array,provider:string):ProviderTick|null{
 if(frame.byteLength!==51||frame[0]!==1||![1,3].includes(frame[1]!))return null;
 const view=new DataView(frame.buffer,frame.byteOffset,frame.byteLength),tokenBytes=frame.subarray(2,27),end=tokenBytes.indexOf(0);
 if(end<1||tokenBytes.subarray(end).some(v=>v!==0))return null;
 const token=String.fromCharCode(...tokenBytes.subarray(0,end));
 if(!/^[1-9]\d*$/.test(token)||!provider)return null;
 const sequence=view.getBigInt64(27,true),millis=view.getBigInt64(35,true),price=view.getBigInt64(43,true);
 if(sequence<0n||millis<=0n||millis>8640000000000000n||price<=0n)return null;
 return {provider,token,exchange:frame[1]===1?'NSE':'BSE',rawLtp:price.toString(),priceDecimals:2,sourceAt:new Date(Number(millis)).toISOString(),sequence:sequence.toString()};
}

export function streamSubscriptionDelta(previous:readonly StreamSubscription[],desired:readonly StreamSubscription[]){
 const key=(s:StreamSubscription)=>s.exchange+'|'+s.token,old=new Set(previous.map(key)),next=new Set(desired.map(key));
 return {remove:previous.filter(s=>!next.has(key(s))),add:desired.filter(s=>!old.has(key(s)))};
}
export function smartApiSubscriptionMessage(action:0|1,items:readonly StreamSubscription[],correlationID:string){
 if(!/^[A-Za-z0-9]{1,10}$/.test(correlationID)||![0,1].includes(action)||!items.length)throw new Error('INVALID_SUBSCRIPTION_REQUEST');
 return {correlationID,action,params:{mode:1,tokenList:([['NSE',1],['BSE',3]] as const).map(([exchange,exchangeType])=>({exchangeType,tokens:[...new Set(items.filter(s=>s.exchange===exchange).map(s=>s.token))]})).filter(group=>group.tokens.length)}};
}
