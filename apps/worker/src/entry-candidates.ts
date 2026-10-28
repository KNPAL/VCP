import {exchangeDate,utcInstant,parseFixed} from '@vcp/domain';
import {canonicalListings,verifiedCalendar,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
type Event={id:string;listingId:string;type:string;session:string;pivot:string;decidedAt:string;observedAt:string;occurredAt:string};
/** Quote observation scope only. Inclusion never grants BUY permission or creates a holding. */
export function activeEntryCandidates(events:readonly Event[],mapping:InstrumentSnapshot|null,calendar:readonly CalendarDay[]|null,asOf:string){
 const now=utcInstant(asOf).valueOf(),date=exchangeDate(asOf),seen=new Set<string>();
 const candidates:{isin:string;listingId:string;pivot:string;validUntil:string}[]=[];
 for(const event of events){try{
  if(event.type!=='BREAKOUT_CONFIRMED'||event.session>=date||[event.decidedAt,event.observedAt,event.occurredAt].some(at=>utcInstant(at).valueOf()>now)||parseFixed(event.pivot)<=0n)continue;
  if(verifiedCalendar(calendar,event.session,date,asOf).state!=='KNOWN')continue;
  const sessions=calendar!.filter(day=>day.date>=event.session&&day.date<=date&&day.kind!=='HOLIDAY').sort((a,b)=>a.date.localeCompare(b.date)),current=sessions.at(-1);
  if(sessions[0]?.date!==event.session||sessions.length<2||sessions.length>3||current?.date!==date||!current.opensAt||!current.closesAt||now<utcInstant(current.opensAt).valueOf()||now>=utcInstant(current.closesAt).valueOf())continue;
  const isin=mapping?.rows.find(row=>row.listingId===event.listingId)?.isin;
  const listing=isin?canonicalListings(mapping?[mapping]:[],[isin],asOf)[0]?.primary:null;
  if(!listing||listing.listingId!==event.listingId||seen.has(listing.isin))continue;
  seen.add(listing.isin);candidates.push({isin:listing.isin,listingId:listing.listingId,pivot:event.pivot,validUntil:current.closesAt});
 }catch{/* Invalid or incomplete source evidence cannot expand quote observation scope. */}}
 return candidates;
}
