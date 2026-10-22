import type {ExitKind} from './exit-precedence.js';
export interface PositionStatusInput {
 quantity:number;partiallySold:boolean;primary:ExitKind|null;health:'FEED_FRESH'|'MONITOR_DEGRADED'|'MARKET_CLOSED';
 protective:'CLEAR'|'UNKNOWN';trailing:'CLEAR'|'NOT_APPLICABLE'|'UNKNOWN';failure:'CLEAR'|'NOT_APPLICABLE'|'UNKNOWN';partial:'CLEAR'|'RESOLVED'|'DISABLED'|'UNKNOWN';
 reasons:readonly string[];
}
/** Lifecycle reflects actual fills; signal and feed state are independent dimensions. */
export function positionStatus(input:PositionStatusInput){
 if(!Number.isSafeInteger(input.quantity)||input.quantity<0)throw new Error('INVALID_POSITION_QUANTITY');
 const closed=input.quantity===0,full=input.primary?.startsWith('SELL_')??false;
 const lifecycle=closed?'CLOSED':full?'EXIT_ALERTED':input.partiallySold?'PARTIALLY_EXITED':'OPEN';
 const missing=Object.entries({protective:input.protective,trailing:input.trailing,failure:input.failure,partial:input.partial}).filter(([,state])=>state==='UNKNOWN').map(([rule])=>rule.toUpperCase()+'_INPUTS_UNAVAILABLE');
 const ready=input.health==='FEED_FRESH'&&missing.length===0;
 return {lifecycle,actualFillState:closed?'CLOSED':input.partiallySold?'PARTIALLY_EXITED':'OPEN',health:input.health,
  action:closed?'CLOSED':input.primary??(ready?'HOLD':'UNABLE_TO_EVALUATE'),
  reasons:[...new Set([...input.reasons,...missing,...(!closed&&input.health!=='FEED_FRESH'?['LIVE_MONITOR_NOT_FRESH']:[])])],
  quantity:input.quantity,executable:false as const};
}
