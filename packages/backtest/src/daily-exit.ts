import {parseFixed,formatFixed,utcInstant,exchangeDate} from '@vcp/domain';
import {validateCandle,verifiedCalendar,type DailyCandle,type CalendarDay,type ActionSnapshot} from '@vcp/market-data';
import {protectiveDecision,partialProfit} from '@vcp/portfolio';
import {configurationHash} from '@vcp/strategy';
import type {HistoricalInputs} from './index.js';

export interface SimulatedPosition {
 id:string;listingId:string;quantity:number;entry:string;initialStop:string;activeStop:string;
 scaleSession:string;stopEffectiveAt:string;partialTaken:boolean;
}
export interface HistoricalExitInput {
 snapshotId:string;strategyRevision:string;dataRevision:string;asOf:string;
 position:SimulatedPosition;bar:DailyCandle&{revisionId:string};calendar:CalendarDay;
 actions:ActionSnapshot|null;tick:string;lotSize:number;
 liquidity:'TRADABLE'|'PRICE_LIMIT_LOCKED'|'UNKNOWN';
 scheduledSell:{id:string;knownAt:string;quantity:number}|null;
 fees:HistoricalInputs['fees'];bias:string|null;
}
const at=(s:string)=>utcInstant(s).valueOf();
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
/** Conservative daily-bar model. Synthetic observations never enter the live quote pipeline. */
export function simulateDailyExit(input:HistoricalExitInput){
 const {bar,calendar,position}=input,cutoff=at(input.asOf),reasons:string[]=[];
 const tick=parseFixed(input.tick),slippage=parseFixed(input.fees.slippageBps),bps=parseFixed(input.fees.sellBps),minimum=parseFixed(input.fees.minimumFee);
 if(tick<=0n||slippage<0n||slippage>=10000000000n||bps<0n||bps>10000000000n||minimum<0n||!input.fees.sourceReference||!Number.isSafeInteger(input.lotSize)||input.lotSize<1||!Number.isSafeInteger(position.quantity)||position.quantity<=0)throw new Error('INVALID_EXIT_CONFIGURATION');
 const result=(state:string,details:Record<string,unknown>={})=>{const body={snapshotId:input.snapshotId,positionId:position.id,session:bar.session,state,reasons:[...new Set(reasons)],sourceAt:bar.finalizedAt&&at(bar.finalizedAt)<=cutoff?bar.finalizedAt:input.asOf,occurredAt:input.asOf,decidedAt:input.asOf,effectiveAt:input.asOf,strategyRevision:input.strategyRevision,dataRevision:input.dataRevision,bias:input.bias,assumptions:input,simulated:true,executable:false,performanceVerified:false,...details};return {id:configurationHash(body),...body}};
 if(!input.snapshotId||!input.strategyRevision||!input.dataRevision||!bar.revisionId)throw new Error('EXIT_REVISIONS_REQUIRED');
 if(!validateCandle(bar,input.asOf).valid||!bar.finalizedAt||at(bar.finalizedAt)>cutoff)reasons.push('FINALIZED_BAR_UNAVAILABLE');
 if(bar.listingId!==position.listingId||bar.session!==calendar.date||!calendar.verified||!calendar.source||at(calendar.knownAt)>cutoff||calendar.kind==='HOLIDAY'||!calendar.opensAt||!calendar.closesAt||!calendar.finalizedAt||at(calendar.finalizedAt)>cutoff||!bar.finalizedAt||at(bar.finalizedAt)<at(calendar.finalizedAt))reasons.push('TRADING_SESSION_UNVERIFIED');
 if(position.scaleSession>bar.session)reasons.push('POSITION_FUTURE_SCALE');
 try{if(verifiedCalendar([calendar],bar.session,bar.session,input.asOf).state!=='KNOWN')reasons.push('CALENDAR_UNKNOWN')}catch{reasons.push('CALENDAR_INVALID')}
 if(input.liquidity!=='TRADABLE'||BigInt(bar.volume)===0n)reasons.push('FILL_NOT_ASSURED');
 const source=input.actions;
 if(!source||source.listingId!==position.listingId||!source.verified||!source.sourceReference||!calendar.opensAt||at(source.knownAt)>at(calendar.opensAt)||source.coverageFrom>position.scaleSession||source.coverageThrough<bar.session)reasons.push('ACTION_HISTORY_UNAVAILABLE_AT_OPEN');
 if(reasons.length)return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null});
 let numerator=1n,denominator=1n;
 const actions=source!.actions.filter(action=>exchangeDate(action.effectiveAt)>position.scaleSession&&exchangeDate(action.effectiveAt)<=bar.session).sort((a,b)=>at(a.effectiveAt)-at(b.effectiveAt)||a.id.localeCompare(b.id));
 if(new Set(actions.map(action=>action.id)).size!==actions.length)throw new Error('DUPLICATE_CORPORATE_ACTION');
 for(const action of actions){
  if(!['SPLIT','BONUS'].includes(action.kind)||action.listingId!==position.listingId||!action.verified||!action.sourceReference||at(action.knownAt)>at(source!.knownAt)||at(action.effectiveAt)>at(calendar.opensAt!)||!/^\d+$/.test(action.sharesAfter)||!/^\d+$/.test(action.sharesBefore)||BigInt(action.sharesAfter)<=0n||BigInt(action.sharesBefore)<=0n||(action.kind==='BONUS'&&BigInt(action.sharesAfter)<=BigInt(action.sharesBefore))){reasons.push('ACTION_NOT_VERIFIED_AT_OPEN');break}
  numerator*=BigInt(action.sharesAfter);denominator*=BigInt(action.sharesBefore);
 }
 if(BigInt(position.quantity)*numerator%denominator!==0n)reasons.push('FRACTIONAL_SHARE_ENTITLEMENT_UNKNOWN');
 const quantity=BigInt(position.quantity)*numerator/denominator;
 if(quantity>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('QUANTITY_OVERFLOW');
 if(at(position.stopEffectiveAt)>at(calendar.opensAt!))reasons.push('STOP_NOT_EFFECTIVE_AT_OPEN');
 if(reasons.length)return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null});
 const scaled=(price:string)=>parseFixed(price)*denominator/numerator;
 const entry=scaled(position.entry),initial=scaled(position.initialStop)/tick*tick,active=scaled(position.activeStop)/tick*tick;
 if(entry<=initial||initial<=0n||active<=0n){reasons.push('INVALID_POSITION_RISK');return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null})}
 const adjusted={...position,quantity:Number(quantity),entry:formatFixed(entry),initialStop:formatFixed(initial),activeStop:formatFixed(active),scaleSession:bar.session};
 const scale=configurationHash({actions,previous:position.scaleSession}),stop={listingId:position.listingId,activeStop:adjusted.activeStop,scaleRevision:scale,effectiveAt:calendar.opensAt!};
 const quote=(price:string)=>({listingId:position.listingId,ltp:price,sourceAt:input.asOf,receivedAt:input.asOf,session:bar.session,quality:'FRESH',connection:'CONNECTED',validUntil:new Date(cutoff+1).toISOString()});
 if(exchangeDate(input.asOf)!==bar.session){reasons.push('DECISION_NOT_IN_SESSION');return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null})}
 const gap=protectiveDecision(stop,quote(bar.open),scale,Number(quantity),input.asOf),touch=protectiveDecision(stop,quote(bar.low),scale,Number(quantity),input.asOf);
 const profit=partialProfit(adjusted.entry,{...stop,activeStop:adjusted.initialStop},quote(bar.high),scale,Number(quantity),input.lotSize,input.asOf);
 const fill=(kind:string,base:bigint,sellQuantity:number,modeledAt:string,ambiguous=false)=>{
  const price=base*(10000000000n-slippage)/10000000000n/tick*tick;
  if(price<=0n){reasons.push('MODELED_PRICE_NOT_POSITIVE');return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null,adjusted})}
  const cost=ceil(price*BigInt(sellQuantity)*bps,10000000000n),fees=cost>minimum?cost:minimum;
  return result('SIMULATED_EXIT',{kind,stage:kind==='PARTIAL_2R'?'AFTER_ENTRIES':'BEFORE_ENTRIES',quantity:sellQuantity,adjusted,remainingQuantity:Number(quantity)-sellQuantity,ambiguousStopAndTarget:ambiguous,fill:{side:'SELL',price:formatFixed(price),fees:formatFixed(fees),modeledAt,cashAvailableAt:modeledAt,interval:[calendar.opensAt,calendar.closesAt],guaranteed:false}});
 };
 const ambiguous=!position.partialTaken&&touch.state==='SELL_PROTECTIVE'&&profit.state==='PARTIAL_PROFIT';
 if(gap.state==='SELL_PROTECTIVE')return fill('PROTECTIVE_GAP',parseFixed(bar.open),Number(quantity),calendar.opensAt!,ambiguous);
 if(touch.state==='SELL_PROTECTIVE')return fill('PROTECTIVE_STOP',active,Number(quantity),calendar.closesAt!,ambiguous);
 if(input.scheduledSell){
  const scheduled=input.scheduledSell;if(!scheduled.id||at(scheduled.knownAt)>=at(calendar.opensAt!)||!Number.isSafeInteger(scheduled.quantity)||scheduled.quantity<=0||BigInt(scheduled.quantity)*numerator%denominator!==0n||BigInt(scheduled.quantity)*numerator/denominator>quantity){reasons.push('SCHEDULED_SELL_UNAVAILABLE');return result('UNABLE_TO_SIMULATE',{quantity:0,fill:null,adjusted})}
  return fill('PRIOR_EOD_SELL',parseFixed(bar.open),Number(BigInt(scheduled.quantity)*numerator/denominator),calendar.opensAt!);
 }
 if(!position.partialTaken&&profit.state==='PARTIAL_PROFIT')return fill('PARTIAL_2R',entry+2n*(entry-initial),profit.suggestedQuantity,calendar.closesAt!);
 return result('NO_EXIT',{quantity:0,fill:null,adjusted});
}
