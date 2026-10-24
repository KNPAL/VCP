import {exchangeDate,utcInstant,parseFixed,formatFixed} from '@vcp/domain';
import {protectiveDecision} from '@vcp/portfolio';
import {configurationHash} from '@vcp/strategy';
import {verifiedCalendar} from '@vcp/market-data';
import type {HistoricalExitInput} from './daily-exit.js';

export type OpeningExitInput=Omit<HistoricalExitInput,'bar'|'actions'> & {
 buySession:string;
 opening:{price:string;sourceAt:string;knownAt:string;sourceReference:string}|null;
};
/** Opening-only evidence: no high, low, close or finalized daily bar is accepted. */
export function simulateOpeningExit(input:OpeningExitInput){
 const {position,calendar,opening}=input,now=utcInstant(input.asOf).valueOf(),reasons:string[]=[];
 const tick=parseFixed(input.tick),slip=parseFixed(input.fees.slippageBps),bps=parseFixed(input.fees.sellBps),minimum=parseFixed(input.fees.minimumFee);
 if(tick<=0n||slip<0n||slip>=10000000000n||bps<0n||bps>10000000000n||minimum<0n||!input.fees.sourceReference||!Number.isSafeInteger(position.quantity)||position.quantity<=0)throw new Error('INVALID_EXIT_CONFIGURATION');
 if(!input.snapshotId||!input.strategyRevision||!input.dataRevision)throw new Error('EXIT_REVISIONS_REQUIRED');
 const result=(state:string,kind:string|null=null,fill:{side:string;price:string;fees:string;modeledAt:string;cashAvailableAt:string;guaranteed:boolean}|null=null)=>{
  const body={snapshotId:input.snapshotId,positionId:position.id,session:calendar.date,state,kind,reasons,quantity:fill?position.quantity:0,adjusted:position,fill,sourceAt:input.asOf,occurredAt:input.asOf,decidedAt:input.asOf,effectiveAt:input.asOf,strategyRevision:input.strategyRevision,dataRevision:input.dataRevision,bias:input.bias,assumptions:input,simulated:true,executable:false,performanceVerified:false};
  return {id:configurationHash(body),...body};
 };
 if(!calendar.verified||!calendar.source||calendar.kind==='HOLIDAY'||!calendar.opensAt||utcInstant(calendar.opensAt).valueOf()!==now||utcInstant(calendar.knownAt).valueOf()>now||exchangeDate(input.asOf)!==calendar.date)reasons.push('OPENING_SESSION_UNVERIFIED');
 try{if(verifiedCalendar([calendar],calendar.date,calendar.date,input.asOf).state!=='KNOWN')reasons.push('CALENDAR_UNKNOWN')}catch{reasons.push('CALENDAR_INVALID')}
 if(!opening||!opening.sourceReference||utcInstant(opening.sourceAt).valueOf()!==now||utcInstant(opening.knownAt).valueOf()!==now)reasons.push('OPENING_PRICE_UNAVAILABLE');
 if(input.buySession>=calendar.date)reasons.push('POSITION_NOT_HELD_BEFORE_OPEN');
 if(position.scaleSession!==calendar.date||utcInstant(position.stopEffectiveAt).valueOf()>now)reasons.push('OPENING_STOP_UNAVAILABLE');
 if(input.liquidity!=='TRADABLE')reasons.push('FILL_NOT_ASSURED');
 if(reasons.length)return result('UNABLE_TO_SIMULATE');
 const price=parseFixed(opening!.price);if(price<=0n)throw new Error('INVALID_OPENING_PRICE');
 const stop={listingId:position.listingId,activeStop:position.activeStop,scaleRevision:input.dataRevision,effectiveAt:position.stopEffectiveAt};
 const quote={listingId:position.listingId,ltp:opening!.price,sourceAt:input.asOf,receivedAt:input.asOf,session:calendar.date,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(now+1).toISOString()};
 const protection=protectiveDecision(stop,quote,input.dataRevision,position.quantity,input.asOf);
 if(protection.state==='UNABLE_TO_EVALUATE'){reasons.push('OPENING_STOP_UNAVAILABLE');return result('UNABLE_TO_SIMULATE')}
 let kind:string|null=protection.state==='SELL_PROTECTIVE'?'PROTECTIVE_GAP':null;
 if(!kind&&input.scheduledSell){
  if(!input.scheduledSell.id||utcInstant(input.scheduledSell.knownAt).valueOf()>=now||input.scheduledSell.quantity!==position.quantity){reasons.push('SCHEDULED_SELL_UNAVAILABLE');return result('UNABLE_TO_SIMULATE')}
  kind='PRIOR_EOD_SELL';
 }
 if(!kind)return result('NO_EXIT');
 const execution=price*(10000000000n-slip)/10000000000n/tick*tick;
 if(execution<=0n){reasons.push('MODELED_PRICE_NOT_POSITIVE');return result('UNABLE_TO_SIMULATE')}
 const proportional=(execution*BigInt(position.quantity)*bps+9999999999n)/10000000000n,fees=proportional>minimum?proportional:minimum;
 return result('SIMULATED_EXIT',kind,{side:'SELL',price:formatFixed(execution),fees:formatFixed(fees),modeledAt:input.asOf,cashAvailableAt:input.asOf,guaranteed:false});
}
