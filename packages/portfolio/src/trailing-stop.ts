import {parseFixed,formatFixed,utcInstant,sessionDate} from '@vcp/domain';
export interface TrailInput {
 entry:string;initialStop:string;activeStop:string;tick:string;close:string;ema21:string|null;atr14:string|null;
 activated:boolean;scaleVerified:boolean;session:string;closedAt:string;finalizedAt:string;asOf:string;
 nextSession:{date:string;opensAt:string}|null;sourceRevision:string;
}
/** EOD-only computation. The returned stop never applies to the evaluated bar. */
export function trailingStop(input:TrailInput){
 const reasons:string[]=[];sessionDate(input.session);
 const at=utcInstant(input.asOf),closed=utcInstant(input.closedAt),finalized=utcInstant(input.finalizedAt);
 if(finalized<closed||finalized>at||closed>at)reasons.push('SESSION_NOT_FINAL');
 if(!input.scaleVerified)reasons.push('PRICE_SCALE_UNVERIFIED');
 if(!input.sourceRevision)reasons.push('SOURCE_REVISION_REQUIRED');
 const p=(v:string)=>parseFixed(v,8,24),entry=p(input.entry),initial=p(input.initialStop),old=p(input.activeStop),tick=p(input.tick),close=p(input.close);
 if(entry<=initial||initial<=0n||old<initial||tick<100n||tick%100n!==0n||close<=0n)reasons.push('INVALID_STOP_BASIS');
 if(input.ema21===null||input.atr14===null)reasons.push('TRAIL_INDICATORS_UNAVAILABLE');
 const next=input.nextSession;
 if(!next||next.date<=input.session||utcInstant(next.opensAt)<=closed)reasons.push('NEXT_SESSION_UNAVAILABLE');
 else sessionDate(next.date);
 const base={session:input.session,asOf:input.asOf,sourceRevision:input.sourceRevision,previousStop:input.activeStop,executable:false as const};
 if(reasons.length)return {...base,state:'UNKNOWN' as const,reasons,activated:input.activated,nextStop:null,effectiveAt:null};
 const ema=p(input.ema21!),atr=p(input.atr14!);
 if(ema<=0n||atr<0n)return {...base,state:'UNKNOWN' as const,reasons:['TRAIL_INDICATORS_INVALID'],activated:input.activated,nextStop:null,effectiveAt:null};
 const activated=input.activated||close>=entry+(entry-initial),weakness=close<ema;
 const effectiveAt=new Date(Math.max(at.valueOf(),utcInstant(next!.opensAt).valueOf())).toISOString();
 if(!activated)return {...base,state:'WAITING_1R' as const,reasons:weakness?['EMA_WEAKNESS']:[],activated:false,nextStop:input.activeStop,effectiveAt};
 const twiceCandidate=2n*ema-atr;
 if(twiceCandidate>=2n*close)return {...base,state:'SELL_EMA_CLOSE' as const,reasons:['CANDIDATE_AT_OR_ABOVE_CLOSE'],activated:true,nextStop:input.activeStop,effectiveAt};
 const candidate=twiceCandidate<=0n?0n:twiceCandidate/(2n*tick)*tick,nextStop=candidate>old?candidate:old;
 return {...base,state:nextStop>old?'TRAIL_UPDATE' as const:'TRAIL_UNCHANGED' as const,reasons:weakness?['EMA_WEAKNESS']:[],activated:true,nextStop:formatFixed(nextStop/100n),effectiveAt};
}
