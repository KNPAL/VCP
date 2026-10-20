import {parseFixed,formatFixed,utcInstant,exchangeDate} from '@vcp/domain';
import {validateInstrumentSnapshot,type InstrumentSnapshot} from './instruments.js';
export interface ProviderTick {provider:string;token:string;exchange:'NSE'|'BSE';rawLtp:string;priceDecimals:0|2|6;sourceAt:string;sequence:string}
export interface QuoteSession {date:string;opensAt:string;closesAt:string;knownAt:string;verified:boolean}
export interface NormalizedQuote {listingId:string;provider:string;token:string;mappingRevision:string;rawLtp:string;priceDecimals:number;ltp:string;sourceAt:string;receivedAt:string;session:string;sequence:string;quality:'FRESH';connection:'CONNECTED';executable:false}
export function normalizeLiveTick(tick:ProviderTick,mapping:InstrumentSnapshot|null,session:QuoteSession|null,receivedAt:string,connected:boolean):{state:'KNOWN';quote:NormalizedQuote}|{state:'UNKNOWN';reason:string}{
 try{
  const received=utcInstant(receivedAt).valueOf(),source=utcInstant(tick.sourceAt).valueOf();
  if(!connected)return {state:'UNKNOWN',reason:'FEED_DISCONNECTED'};
  if(!/^\d{1,24}$/.test(tick.rawLtp)||!/^(0|[1-9]\d{0,19})$/.test(tick.sequence)||![0,2,6].includes(tick.priceDecimals)||!tick.provider||!/^\d+$/.test(tick.token))return {state:'UNKNOWN',reason:'INVALID_TICK'};
  if(source>received||received-source>60000)return {state:'UNKNOWN',reason:source>received?'FUTURE_TICK':'STALE_TICK'};
  if(!session||!session.verified||utcInstant(session.knownAt).valueOf()>received||session.date!==exchangeDate(tick.sourceAt)||session.date!==exchangeDate(receivedAt)||source<utcInstant(session.opensAt).valueOf()||source>utcInstant(session.closesAt).valueOf())return {state:'UNKNOWN',reason:'SESSION_UNVERIFIED_OR_CLOSED'};
  if(!mapping||utcInstant(mapping.knownAt).valueOf()>source)return {state:'UNKNOWN',reason:'TOKEN_MAPPING_UNAVAILABLE'};
  validateInstrumentSnapshot(mapping);
  const rows=mapping.rows.filter(r=>r.provider===tick.provider&&r.token===tick.token&&r.exchange===tick.exchange&&r.validFrom<=session.date&&(r.validTo===null||session.date<r.validTo));
  const row=rows[0];if(rows.length!==1||!row||!row.verified||!row.enabled||row.instrumentType!=='EQUITY'||!(row.exchange==='NSE'&&row.series==='EQ'||row.exchange==='BSE'&&row.series==='CASH'))return {state:'UNKNOWN',reason:'TOKEN_MAPPING_UNAVAILABLE'};
  const units=BigInt(tick.rawLtp)*10n**BigInt(6-tick.priceDecimals);if(units<=0n||units%parseFixed(row.tick)!==0n)return {state:'UNKNOWN',reason:'INVALID_QUOTE_PRICE'};
  const ltp=formatFixed(units);parseFixed(ltp);
  return {state:'KNOWN',quote:{listingId:row.listingId,provider:tick.provider,token:tick.token,mappingRevision:mapping.id,rawLtp:tick.rawLtp,priceDecimals:tick.priceDecimals,ltp,sourceAt:tick.sourceAt,receivedAt,session:session.date,sequence:tick.sequence,quality:'FRESH',connection:'CONNECTED',executable:false}};
 }catch{return {state:'UNKNOWN',reason:'INVALID_TICK_CONTEXT'}}
}
