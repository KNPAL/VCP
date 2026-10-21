export type ExitKind='SELL_PROTECTIVE'|'SELL_BREAKOUT_FAILURE'|'SELL_EMA_CLOSE'|'PARTIAL_PROFIT';
export interface ExitCandidate {id:string;kind:ExitKind;recognizedAt:string;effectiveAt:string;sourceRevision:string;resolved:boolean}
const priorities:Record<ExitKind,number>={SELL_PROTECTIVE:0,SELL_BREAKOUT_FAILURE:1,SELL_EMA_CLOSE:2,PARTIAL_PROFIT:3};
/** Recognized scheduled exits remain visible before their effective session. */
export function exitPrecedence(candidates:readonly ExitCandidate[],quantity:number,asOf:string){
 const time=Date.parse(asOf);if(!Number.isFinite(time)||!Number.isSafeInteger(quantity)||quantity<0)throw new Error('INVALID_EXIT_EVALUATION');
 const visible=candidates.filter(c=>!c.resolved&&Date.parse(c.recognizedAt)<=time);
 if(visible.some(c=>!Number.isFinite(Date.parse(c.effectiveAt))||!c.sourceRevision||!(c.kind in priorities)))throw new Error('INVALID_EXIT_CANDIDATE');
 const ordered=[...visible].sort((a,b)=>priorities[a.kind]-priorities[b.kind]||Date.parse(a.recognizedAt)-Date.parse(b.recognizedAt)||a.id.localeCompare(b.id));
 const primary=quantity>0?ordered[0]??null:null;
 return {state:quantity===0?'CLOSED_WITHOUT_SIGNAL_EXECUTION':primary?.kind??'NO_EXIT_SIGNAL',primary,secondary:ordered.filter(c=>c.id!==primary?.id),effective:!!primary&&Date.parse(primary.effectiveAt)<=time,executable:false as const};
}
