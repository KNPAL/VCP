import {parseFixed,utcInstant,sessionDate} from '@vcp/domain';
export interface FailureInput {
 buySession:string;pivot:string|null;scaleVerified:boolean;asOf:string;
 sessions:readonly {date:string;close:string|null;closedAt:string;finalizedAt:string}[];
 nextSessions:readonly {date:string;opensAt:string}[];
}
/** The BUY session itself is excluded from the five-session observation window. */
export function breakoutFailure(input:FailureInput){
 sessionDate(input.buySession);const at=utcInstant(input.asOf),reasons:string[]=[];
 if(!input.scaleVerified)reasons.push('PRICE_SCALE_UNVERIFIED');
 if(input.pivot===null||parseFixed(input.pivot)<=0n)reasons.push('FROZEN_PIVOT_UNAVAILABLE');
 const days=input.sessions.filter(s=>s.date>input.buySession).slice(0,5);
 for(let i=0;i<days.length;i++){
  const d=days[i]!;sessionDate(d.date);
  if(i>0&&days[i-1]!.date>=d.date)reasons.push('INVALID_SESSION_ORDER');
  if(d.close===null||parseFixed(d.close)<=0n)reasons.push('CLOSE_UNAVAILABLE');
  if(utcInstant(d.finalizedAt)>at||utcInstant(d.finalizedAt)<utcInstant(d.closedAt))reasons.push('SESSION_NOT_FINAL');
 }
 const base={asOf:input.asOf,observedSessions:days.length,executable:false as const};
 if(reasons.length)return {...base,state:'UNKNOWN' as const,reasons:[...new Set(reasons)],triggerSession:null,effectiveAt:null};
 for(let i=1;i<days.length;i++)if(parseFixed(days[i-1]!.close!)<parseFixed(input.pivot!)&&parseFixed(days[i]!.close!)<parseFixed(input.pivot!)){
  const day=days[i]!,next=input.nextSessions.find(s=>s.date>day.date);
  if(!next||utcInstant(next.opensAt)<=utcInstant(day.closedAt))return {...base,state:'UNKNOWN' as const,reasons:['NEXT_SESSION_UNAVAILABLE'],triggerSession:null,effectiveAt:null};
  return {...base,state:'SELL_BREAKOUT_FAILURE' as const,reasons:['TWO_CLOSES_BELOW_FROZEN_PIVOT'],triggerSession:day.date,effectiveAt:new Date(Math.max(at.valueOf(),utcInstant(next.opensAt).valueOf())).toISOString()};
 }
 return {...base,state:days.length===5?'WINDOW_COMPLETE' as const:'OBSERVING' as const,reasons:[],triggerSession:null,effectiveAt:null};
}
