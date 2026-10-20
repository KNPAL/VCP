import {exchangeDate,utcInstant} from '@vcp/domain';
import {verifiedCalendar,type CalendarDay} from './candles.js';
import {canonicalListings,type InstrumentSnapshot} from './instruments.js';
import type {NormalizedQuote} from './live-quotes.js';
export type MonitorAssessment={state:'FEED_FRESH'|'MONITOR_DEGRADED'|'SESSION_CLOSED';reason:string;sourceAt:string|null;listingId:string|null;session:string;validUntil:string|null;executable:false};
/** Feed health only: FEED_FRESH never asserts HOLD or a stop breach. */
export function assessHeldQuote(isin:string,asOf:string,calendar:readonly CalendarDay[]|null,mapping:InstrumentSnapshot|null,quote:{state:'KNOWN';quote:NormalizedQuote&{validUntil:string}}|{state:'UNKNOWN';reason:string}):MonitorAssessment{
 const session=exchangeDate(asOf),result=(state:MonitorAssessment['state'],reason:string,listingId:string|null=null,sourceAt:string|null=null,validUntil:string|null=null):MonitorAssessment=>({state,reason,listingId,sourceAt,session,validUntil,executable:false});
 try{
  const verified=verifiedCalendar(calendar,session,session,asOf);
  if(verified.state!=='KNOWN')return result('MONITOR_DEGRADED','CALENDAR_UNAVAILABLE');
  const day=calendar!.find(d=>d.date===session)!;
  if(day.kind==='HOLIDAY'||utcInstant(asOf)<utcInstant(day.opensAt!)||utcInstant(asOf)>=utcInstant(day.closesAt!))return result('SESSION_CLOSED','OUTSIDE_VERIFIED_SESSION');
  const listing=canonicalListings(mapping?[mapping]:[],[isin],asOf)[0]?.primary;
  if(!listing)return result('MONITOR_DEGRADED','TOKEN_MAPPING_UNAVAILABLE');
  if(quote.state!=='KNOWN')return result('MONITOR_DEGRADED',quote.reason,listing.listingId);
  const q=quote.quote,age=utcInstant(asOf).valueOf()-utcInstant(q.sourceAt).valueOf();
  if(q.listingId!==listing.listingId||q.token!==listing.token||q.provider!==listing.provider||q.mappingRevision!==mapping!.id||q.session!==session||q.connection!=='CONNECTED'||q.quality!=='FRESH'||age<0||age>60000||utcInstant(q.validUntil)<=utcInstant(asOf)||utcInstant(q.receivedAt)>utcInstant(asOf))return result('MONITOR_DEGRADED','QUOTE_CONTEXT_UNVERIFIED',listing.listingId,q.sourceAt);
  return result('FEED_FRESH','QUOTE_AND_CONNECTION_CURRENT',listing.listingId,q.sourceAt,q.validUntil);
 }catch{return result('MONITOR_DEGRADED','INVALID_MONITOR_CONTEXT')}
}

