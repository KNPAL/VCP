import {parseFixed,sessionDate,utcInstant,exchangeDate} from '@vcp/domain';
import {extrema,assembleLegs,type VcpSeries,type Leg,type Swing} from '@vcp/vcp';
export interface IpoListingEvidence {
 listingId:string;isin:string;listingDate:string;issuePrice:string|null;listingPrice:string|null;
 knownAt:string;sourceReference:string;permissionReference:string;verified:boolean;
}
export function validateIpoListing(value:IpoListingEvidence){
 if(!value||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.listingId)||!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.isin)||typeof value.verified!=='boolean'||!value.sourceReference?.trim()||!value.permissionReference?.trim())throw new Error('INVALID_IPO_SOURCE');
 sessionDate(value.listingDate);utcInstant(value.knownAt);
 for(const price of [value.issuePrice,value.listingPrice])if(price!==null&&(typeof price!=='string'||parseFixed(price)<=0n))throw new Error('INVALID_IPO_PRICE');
 if(value.listingPrice!==null&&value.listingDate>exchangeDate(value.knownAt))throw new Error('LISTING_PRICE_BEFORE_LISTING');
 return value;
}
/** Observations only: this profile cannot supply a main-strategy BUY or long-history substitute. */
export function ipoResearch(metadata:IpoListingEvidence|null,series:VcpSeries|null,asOf:string){
 utcInstant(asOf);const reasons:string[]=['RESEARCH_ONLY_NO_BUY'],swings:Swing[]=[],legs:Leg[]=[];
 let state:'UNKNOWN'|'INSUFFICIENT_HISTORY'|'STRUCTURE_OBSERVATION'='UNKNOWN',usable:IpoListingEvidence|null=null;
 if(metadata){validateIpoListing(metadata);if(metadata.verified&&utcInstant(metadata.knownAt)<=utcInstant(asOf)&&metadata.listingDate<=exchangeDate(asOf))usable=metadata;else reasons.push('IPO_SOURCE_UNVERIFIED_OR_NOT_YET_KNOWN')}else reasons.push('IPO_SOURCE_UNAVAILABLE');
 let completedBars=0;
 if(usable&&series){
  try{
   if(utcInstant(series.asOf)>utcInstant(asOf)||series.bars.some(b=>b.session<usable!.listingDate))throw new Error('IPO_SERIES_OUTSIDE_KNOWN_LISTING');
   const found=extrema(series);completedBars=series.bars.length;
   if(completedBars<30){state='INSUFFICIENT_HISTORY';reasons.push('MINIMUM_30_COMPLETED_SESSIONS')}
   else{state='STRUCTURE_OBSERVATION';swings.push(...found.swings);const start=found.swings.findIndex(s=>s.kind==='H');if(start>=0){const paired=found.swings.slice(start);if(paired.length%2)paired.pop();legs.push(...assembleLegs(series,paired))}if(found.ambiguities.length)reasons.push('AMBIGUOUS_EXTREMA_OMITTED');if(!legs.length)reasons.push('NO_CONFIRMED_HIGH_LOW_LEG')}
  }catch(error){reasons.push(error instanceof Error?error.message:'IPO_SERIES_INVALID')}
 }else if(!series)reasons.push('FINALIZED_SERIES_UNAVAILABLE');
 return {profile:'IPO_RESEARCH_ONLY_V1',state,asOf,metadata:usable,completedBars,minimumBars:30,swings,legs,dataRevision:series?.dataRevision??null,
  sma200:null,range252:null,rs250:null,longHistoryReason:'NOT_SUBSTITUTED_BY_SHORT_HISTORY',buyState:'BUY_BLOCKED',buyEligible:false,executable:false,reasons};
}
