/** Combines independently evaluated gates; it never calculates prices, stops or quantities. */
export function authorizeEntryPlan(input:{decision:{state:string;reasons:readonly string[]};sizing:{state:string;quantity:number;reasons:readonly string[]}|null;reasons:readonly string[];live:boolean;expiresAt:string;now:string}){
 const reasons=[...input.reasons,...input.decision.reasons,...(input.sizing?.reasons??['CAP_INPUTS_UNAVAILABLE'])];
 if(input.decision.state!=='BUY_ELIGIBLE'&&!input.decision.reasons.length)reasons.push('ENTRY_RULES_NOT_PASSED');
 if(input.sizing?.state!=='BUY_ELIGIBLE')reasons.push('RISK_SIZING_NOT_PASSED');
 if(!input.live)reasons.push('LIVE_ENTRY_EVIDENCE_REQUIRED');
 if(!Number.isFinite(Date.parse(input.expiresAt))||!Number.isFinite(Date.parse(input.now))||Date.parse(input.expiresAt)<=Date.parse(input.now))reasons.push('PLAN_EXPIRED');
 if(!input.sizing||!Number.isSafeInteger(input.sizing.quantity)||input.sizing.quantity<=0)reasons.push('NO_VALID_ENTRY_QUANTITY');
 const unique=[...new Set(reasons)],eligible=unique.length===0;
 return {state:eligible?'BUY_ELIGIBLE' as const:'BUY_BLOCKED' as const,quantity:eligible?input.sizing!.quantity:0,reasons:unique};
}
import {canonical} from './indicators.js';
export function sameEntryQuote(a:object,b:object){
 const observation=(quote:object)=>Object.fromEntries(Object.entries(quote).filter(([key])=>key!=='validUntil'));
 return canonical(observation(a))===canonical(observation(b));
}
