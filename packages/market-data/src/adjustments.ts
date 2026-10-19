import {createHash} from 'node:crypto';
import {parseFixed,formatFixed,sessionDate,utcInstant,exchangeDate} from '@vcp/domain';
import {validateCandle,type DailyCandle} from './candles.js';

export interface CorporateAction {
 id:string;listingId:string;kind:'SPLIT'|'BONUS';effectiveAt:string;knownAt:string;
 /** Total shares after / shares before. A 1:2 bonus is 3 / 2, not 1 / 2. */
 sharesAfter:string;sharesBefore:string;verified:boolean;sourceReference:string;
}
export interface ActionSnapshot {
 id:string;listingId:string;knownAt:string;verified:boolean;sourceReference:string;
 coverageFrom:string;coverageThrough:string;actions:readonly CorporateAction[];
}
export interface AdjustmentInput {
 listingId:string;asOf:string;scaleSession:string;source:ActionSnapshot;
 raw:readonly (DailyCandle&{revisionId:string})[];
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)).digest('hex');
const instant=(value:string)=>utcInstant(value).valueOf();
function ratio(n:bigint,d:bigint){let a=n,b=d;while(b){const r=a%b;a=b;b=r}return {n:n/a,d:d/a}}
function scaled(value:bigint,n:bigint,d:bigint,scale:number,precision:number){
 const product=value*n,units=product/d+(product%d*2n>=d?1n:0n),result=formatFixed(units,scale);parseFixed(result,scale,precision);return result;
}
/** A complete, verified action-source snapshot is required even when it reports no actions. */
export function adjustCandles(input:AdjustmentInput){
 const {source}=input,cutoff=instant(input.asOf);sessionDate(input.scaleSession);sessionDate(source.coverageFrom);sessionDate(source.coverageThrough);
 if(!input.raw.length)throw new Error('ADJUSTMENT_EMPTY_SERIES');
 const raw=[...input.raw].sort((a,b)=>a.session.localeCompare(b.session));
 if(source.listingId!==input.listingId||raw.some(bar=>bar.listingId!==input.listingId)||new Set(raw.map(bar=>bar.session)).size!==raw.length)throw new Error('ADJUSTMENT_IDENTITY_MISMATCH');
 if(source.coverageFrom>source.coverageThrough||input.scaleSession>exchangeDate(input.asOf)||raw.at(-1)!.session>input.scaleSession)throw new Error('ADJUSTMENT_INVALID_RANGE');
 for(const bar of raw)if(!bar.revisionId||!validateCandle(bar,input.asOf).valid||!bar.finalizedAt)throw new Error('ADJUSTMENT_RAW_INVALID');
 const reasons:string[]=[];
 if(!source.id||!source.verified||!source.sourceReference||instant(source.knownAt)>cutoff)reasons.push('CORPORATE_ACTION_SOURCE_UNVERIFIED');
 if(source.coverageFrom>raw[0]!.session||source.coverageThrough<input.scaleSession)reasons.push('CORPORATE_ACTION_COVERAGE_INCOMPLETE');
 const actions=[...source.actions].sort((a,b)=>a.effectiveAt.localeCompare(b.effectiveAt)||a.id.localeCompare(b.id));
 if(new Set(actions.map(a=>a.id)).size!==actions.length)throw new Error('DUPLICATE_CORPORATE_ACTION');
 for(const action of actions){
  if(!action.id||action.listingId!==input.listingId||!['SPLIT','BONUS'].includes(action.kind)||!/^\d+$/.test(action.sharesAfter)||!/^\d+$/.test(action.sharesBefore)||BigInt(action.sharesAfter)<=0n||BigInt(action.sharesBefore)<=0n)throw new Error('INVALID_CORPORATE_ACTION');
  instant(action.effectiveAt);
  if(action.kind==='BONUS'&&BigInt(action.sharesAfter)<=BigInt(action.sharesBefore))throw new Error('INVALID_BONUS_RATIO');
  if(instant(action.knownAt)>instant(source.knownAt))throw new Error('ACTION_NOT_KNOWN_AT_SNAPSHOT');
  if(exchangeDate(action.effectiveAt)<=input.scaleSession&&instant(action.effectiveAt)>cutoff)reasons.push('CORPORATE_ACTION_NOT_EFFECTIVE:'+action.id);
  if(exchangeDate(action.effectiveAt)<=input.scaleSession&&(!action.verified||!action.sourceReference||instant(action.knownAt)>cutoff))reasons.push('CORPORATE_ACTION_UNVERIFIED:'+action.id);
 }
 const revision=hash({listingId:input.listingId,asOf:input.asOf,scaleSession:input.scaleSession,source:{...source,actions},raw:raw.map(bar=>[bar.revisionId,bar.session])});
 if(reasons.length)return {state:'UNKNOWN' as const,signalsAllowed:false,revision,reasons,bars:[]};
 const bars=raw.map(bar=>{
  let n=1n,d=1n;
  const applied=actions.filter(action=>exchangeDate(action.effectiveAt)>bar.session&&exchangeDate(action.effectiveAt)<=input.scaleSession);
  for(const action of applied){const r=ratio(n*BigInt(action.sharesBefore),d*BigInt(action.sharesAfter));n=r.n;d=r.d}
  const prices=[bar.open,bar.high,bar.low,bar.close].map(value=>scaled(parseFixed(value),n,d,6,20));
  if(prices.some(value=>parseFixed(value)<=0n))throw new Error('ADJUSTED_PRICE_UNDERFLOW');
  return {session:bar.session,rawRevisionId:bar.revisionId,open:prices[0]!,high:prices[1]!,low:prices[2]!,close:prices[3]!,volume:scaled(BigInt(bar.volume)*100000000n,d,n,8,24),priceFactor:{numerator:n.toString(),denominator:d.toString()},actionIds:applied.map(action=>action.id),finalizedAt:bar.finalizedAt!,adjustmentVerified:true};
 });
 return {state:'KNOWN' as const,signalsAllowed:true,revision,reasons,bars};
}
