import {parseFixed,utcInstant,exchangeDate} from '@vcp/domain';
import {projectPortfolio,type PortfolioEvent} from './ledger.js';
export function openEpisode(events:readonly PortfolioEvent[],isin:string,asOf:string):{identity:string;first:Extract<PortfolioEvent,{kind:'FILL'}>;quantity:number}|null{
 const order=(event:PortfolioEvent):number=>{if(event.kind==='FILL'&&event.replacementOf){const original=events.find(e=>e.id===event.replacementOf);if(!original)throw new Error('MISSING_ORIGINAL_FILL');return order(original)}return event.sequence};
 const p=projectPortfolio(events,asOf),visible=events.filter(e=>e.kind==='FILL'&&e.isin===isin&&!p.reversed.includes(e.id)&&utcInstant(e.recordedAt)<=utcInstant(asOf)&&utcInstant(e.occurredAt)<=utcInstant(asOf)).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||order(a)-order(b));
 let quantity=0,first:Extract<PortfolioEvent,{kind:'FILL'}>|null=null;
 for(const event of visible){if(event.kind!=='FILL')continue;if(event.side==='BUY'){if(quantity===0)first=event;quantity+=event.quantity}else quantity-=event.quantity;if(quantity===0)first=null}
 if(!first||quantity<=0)return null;
 let identity:PortfolioEvent=first;
 while(identity.kind==='FILL'&&identity.replacementOf){const target:string=identity.replacementOf;const original:PortfolioEvent|undefined=events.find(e=>e.id===target);if(!original)throw new Error('MISSING_ORIGINAL_FILL');identity=original}
 return {identity:identity.id,first,quantity};
}
export interface ProtectiveStop {listingId:string;activeStop:string;scaleRevision:string;effectiveAt:string}
export interface ProtectiveQuote {listingId:string;ltp:string;sourceAt:string;receivedAt:string;session:string;quality:string;connection:string;validUntil:string}
export function protectiveDecision(stop:ProtectiveStop|null,quote:ProtectiveQuote|null,scaleRevision:string|null,quantity:number,asOf:string){
 const reasons:string[]=[];const now=utcInstant(asOf).valueOf();
 if(!Number.isSafeInteger(quantity)||quantity<=0)return {state:'CLOSED' as const,reasons:['NO_OPEN_POSITION'],executable:false as const};
 if(!stop)reasons.push('ACTIVE_STOP_UNAVAILABLE');
 if(!quote)reasons.push('FRESH_QUOTE_UNAVAILABLE');
 if(stop&&(utcInstant(stop.effectiveAt).valueOf()>now||parseFixed(stop.activeStop)<=0n))reasons.push('STOP_NOT_EFFECTIVE');
 if(stop&&(!scaleRevision||stop.scaleRevision!==scaleRevision))reasons.push('PRICE_SCALE_UNVERIFIED');
 if(quote){
  const source=utcInstant(quote.sourceAt).valueOf(),received=utcInstant(quote.receivedAt).valueOf();
  if(source>received||received>now||now-source>60000||utcInstant(quote.validUntil).valueOf()<=now||quote.session!==exchangeDate(asOf)||quote.quality!=='FRESH'||quote.connection!=='CONNECTED'||parseFixed(quote.ltp)<=0n)reasons.push('FRESH_QUOTE_UNAVAILABLE');
  if(stop&&quote.listingId!==stop.listingId)reasons.push('LISTING_MISMATCH');
  if(stop&&source<utcInstant(stop.effectiveAt).valueOf())reasons.push('QUOTE_BEFORE_STOP_EFFECTIVE');
 }
 if(reasons.length)return {state:'UNABLE_TO_EVALUATE' as const,reasons:[...new Set(reasons)],executable:false as const};
 return {state:parseFixed(quote!.ltp)<=parseFixed(stop!.activeStop)?'SELL_PROTECTIVE' as const:'NOT_BREACHED' as const,reasons,observedTickAt:quote!.sourceAt,triggeredPrice:quote!.ltp,recognizedAt:asOf,quality:quote!.quality,quantity,executable:false as const};
}
