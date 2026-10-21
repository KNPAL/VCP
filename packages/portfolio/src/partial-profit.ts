import {parseFixed} from '@vcp/domain';
import {protectiveDecision,type ProtectiveStop,type ProtectiveQuote} from './protective-stop.js';
export function partialProfit(entry:string,initial:ProtectiveStop|null,quote:ProtectiveQuote|null,scale:string|null,quantity:number,lotSize:number,asOf:string){
 if(!Number.isSafeInteger(lotSize)||lotSize<=0)throw new Error('INVALID_LOT_SIZE');
 const protection=protectiveDecision(initial,quote,scale,quantity,asOf);
 if(protection.state==='CLOSED'||protection.state==='UNABLE_TO_EVALUATE')return {...protection,suggestedQuantity:0};
 const first=parseFixed(entry),risk=first-parseFixed(initial!.activeStop);
 if(risk<=0n)return {state:'UNABLE_TO_EVALUATE' as const,reasons:['INITIAL_RISK_INVALID'],suggestedQuantity:0,executable:false as const};
 const suggested=Number(BigInt(quantity)/3n/BigInt(lotSize)*BigInt(lotSize));
 const reached=parseFixed(quote!.ltp)>=first+2n*risk;
 return {state:!reached?'BELOW_2R' as const:suggested===0?'LOT_TOO_SMALL' as const:'PARTIAL_PROFIT' as const,reasons:[],suggestedQuantity:reached?suggested:0,sourceAt:quote!.sourceAt,triggeredPrice:quote!.ltp,asOf,executable:false as const};
}
