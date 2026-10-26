import {parseFixed,formatFixed,utcInstant} from '@vcp/domain';
import {extrema,type VcpSeries} from '@vcp/vcp';
export interface ProxySourceProof {sourceReference:string;permissionReference:string;knownAt:string;validUntil:string;verified:boolean;displayAllowed:boolean|null;deriveAllowed:boolean|null}
/** Optional comparator only. It never supplies eligibility to the main structural strategy. */
export function momentumProxyResearch(series:VcpSeries|null,proof:ProxySourceProof|null,asOf:string){
 const now=utcInstant(asOf).valueOf(),reasons=['RESEARCH_ONLY_NO_BUY','NOT_STRICT_STRUCTURAL_VCP'];
 const base={profile:'TRENDSPIDER_STYLE_100D_BREAKOUT',asOf,buyState:'BUY_BLOCKED',buyEligible:false,executable:false,structuralVcp:false,broaderProxy:{profile:'TRENDSPIDER_STYLE_VCP_PROXY',state:'UNKNOWN',reason:'PROXY_THRESHOLDS_UNCONFIGURED',requiredInputs:['MARKET_CAP','SMA20','RELATIVE_PERFORMANCE','100_DAY_PROXIMITY','WEEKLY_PROXIMITY','ROLLING_HIGHER_LOWS','20_DAY_VOLUME_DECLINE']}};
 const unknown=(reason:string)=>({...base,state:'UNKNOWN',label:null,prior100High:null,rvol20Prev:null,sourceAt:null,dataRevision:null,reasons:[...reasons,reason]});
 if(!proof||!proof.verified||!proof.sourceReference?.trim()||!proof.permissionReference?.trim()||proof.displayAllowed!==true||proof.deriveAllowed!==true)return unknown('PROXY_SOURCE_UNAVAILABLE_OR_NOT_PERMITTED');
 if(utcInstant(proof.knownAt).valueOf()>now||utcInstant(proof.validUntil).valueOf()<=now)return unknown('PROXY_SOURCE_NOT_CURRENT');
 if(!series)return unknown('FINALIZED_SERIES_UNAVAILABLE');
 try{
  if(utcInstant(series.asOf).valueOf()>now)return unknown('PROXY_SERIES_NOT_YET_KNOWN');
  extrema(series); // Reuses production adjusted-series, calendar alignment and completed-bar validation.
  if(series.bars.length<101)return unknown('MINIMUM_101_COMPLETED_SESSIONS');
  const current=series.bars.at(-1)!,previous=series.bars.slice(-101,-1),high=previous.reduce((best,b)=>{const n=parseFixed(b.high);return n>best?n:best},0n);
  const priorVolume=series.bars.slice(-21,-1).reduce((total,b)=>total+parseFixed(b.volume,8,24),0n),volume=parseFixed(current.volume,8,24);
  if(priorVolume===0n)return unknown('PRIOR_VOLUME_BASELINE_ZERO');
  const breakout=parseFixed(current.close)>high&&volume*20n>priorVolume;
  return {...base,state:breakout?'MOMENTUM_PROXY_BREAKOUT':'NO_PROXY_BREAKOUT',label:breakout?'MOMENTUM_PROXY_BREAKOUT':null,prior100High:formatFixed(high),rvol20Prev:formatFixed(volume*20n*1000000n/priorVolume),sourceAt:current.finalizedAt,dataRevision:series.dataRevision,sourceReference:proof.sourceReference,reasons};
 }catch(error){return unknown(error instanceof Error?error.message:'PROXY_SERIES_INVALID')}
}
