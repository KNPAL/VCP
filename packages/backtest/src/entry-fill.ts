import {parseFixed,formatFixed,utcInstant} from '@vcp/domain';
import {structuralStop,evaluateEntry,configurationHash,canonicalConfiguration,type EntryInput} from '@vcp/strategy';
import {sizeEntry,entrySizingGates,type PortfolioValue} from '@vcp/portfolio';
import type {HistoricalSnapshot} from './index.js';

export interface HistoricalEntryInput {
 snapshotId:string;event:EntryInput['event'];now:string;earliestFillAt:string|null;
 opening:{price:string;sourceAt:string;knownAt:string;sourceReference:string}|null;
 portfolio:PortfolioValue;isin:string;sector:string|null;lotSize:number;lossStreakPass:boolean|null;
 market:Omit<EntryInput,'event'|'now'|'quote'|'heartbeatAt'|'riskGates'>;
 fees:HistoricalSnapshot['inputs']['fees'];
}
const at=(value:string)=>utcInstant(value).valueOf();
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
/** Research-only opening fill. Shared live entry/sizing gates are applied to simulated as-of state. */
export function simulateOpeningEntry(input:HistoricalEntryInput){
 const now=at(input.now),reasons:string[]=[];
 if(!input.snapshotId||!input.fees.sourceReference)throw new Error('ENTRY_SNAPSHOT_REQUIRED');
 if(!input.earliestFillAt||now!==at(input.earliestFillAt)||now<=at(input.event.decidedAt))reasons.push('NOT_NEXT_OPEN');
 const calendar=input.market.calendar,index=calendar?.findIndex(day=>day.date===input.event.session)??-1;
 if(!calendar||index<0||!calendar[index+1]||at(calendar[index+1]!.opensAt)!==now)reasons.push('NOT_FIRST_FOLLOWING_SESSION_OPEN');
 if(at(input.portfolio.asOf)!==now)reasons.push('PORTFOLIO_NOT_ASOF_OPEN');
 if(input.portfolio.positions.some(position=>position.isin===input.isin&&position.quantity>0))reasons.push('AUTOMATIC_ADD_PROHIBITED');
 const opening=input.opening;
 if(!opening||!opening.sourceReference||at(opening.sourceAt)!==now||at(opening.knownAt)!==now)reasons.push('OPENING_PRICE_UNAVAILABLE');
 const bps=parseFixed(input.fees.buyBps),slippage=parseFixed(input.fees.slippageBps),minimum=parseFixed(input.fees.minimumFee),tick=parseFixed(input.market.tick);
 if(tick<=0n||bps<0n||slippage<0n||bps>10000000000n||slippage>10000000000n||minimum<0n)throw new Error('INVALID_FILL_COST');
 const base=opening?parseFixed(opening.price):0n;if(opening&&base<=0n)throw new Error('INVALID_OPENING_PRICE');
 const price=base?ceil(ceil(base*(10000000000n+slippage),10000000000n),tick)*tick:0n;
 const fee=(quantity:number)=>{const proportional=ceil(price*BigInt(quantity)*bps,10000000000n);return proportional>minimum?proportional:minimum};
 const stop=price?structuralStop(input.event.lastLow,input.market.tick,formatFixed(price)):null;
 let sizing:ReturnType<typeof sizeEntry>|null=null,quantity=0;
 if(stop&&!stop.reasons.length){
  const size=(fees:bigint)=>sizeEntry({portfolio:input.portfolio,isin:input.isin,sector:input.sector,entry:formatFixed(price),stop:stop.stop,regime:input.market.regime,lotSize:input.lotSize,estimatedFees:formatFixed(fees),lossStreakPass:input.lossStreakPass});
  const upper=size(0n);let low=0,high=Math.floor(upper.quantity/input.lotSize);
  // Fees change equity and every exposure cap; solve quantity using the same live sizing function.
  while(low<high){const middle=low+Math.ceil((high-low)/2),candidate=middle*input.lotSize,result=size(fee(candidate));if(result.state==='BUY_ELIGIBLE'&&result.quantity>=candidate)low=middle;else high=middle-1}
  quantity=low*input.lotSize;sizing=size(fee(quantity));
  if(quantity===0)reasons.push('NO_AFFORDABLE_LOT');
 }else reasons.push(...(stop?.reasons??['STOP_UNAVAILABLE']));
 // PostgreSQL JSONB reorders object keys. Normalize before the shared evaluator derives its ID.
 const entryInput=JSON.parse(canonicalConfiguration({...input.market,event:input.event,now:input.now,quote:price?{price:formatFixed(price),at:opening!.sourceAt}:null,heartbeatAt:opening?.sourceAt??null,riskGates:entrySizingGates(sizing,input.lotSize,input.lossStreakPass)})) as EntryInput;
 const decision=evaluateEntry(entryInput);
 reasons.push(...decision.reasons,...(sizing?.reasons??[]));
 const unique=[...new Set(reasons)],allowed=unique.length===0&&quantity>0;
 const state=allowed?'SIMULATED_FILL':unique.includes('MISSED_ENTRY')?'MISSED':'BUY_BLOCKED';
 const body={snapshotId:input.snapshotId,marketEventId:input.event.id,state,reasons:unique,sourceAt:opening&&at(opening.sourceAt)<=now?opening.sourceAt:input.now,occurredAt:input.now,decidedAt:input.now,effectiveAt:input.now,strategyRevision:input.event.configHash,dataRevision:input.event.dataRevision,price:price?formatFixed(price):null,quantity:allowed?quantity:0,fees:allowed?formatFixed(fee(quantity)):null,stop:stop?.stop??null,decision,sizing,assumptions:input,simulated:true,executable:false,performanceVerified:false};
 return {id:configurationHash(body),...body};
}
