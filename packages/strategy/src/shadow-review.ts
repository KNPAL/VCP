/** Offline post-V1 contract only. No provider, decision, journal or order capabilities. */
export const SHADOW_CONTRACT_VERSION='AI_SHADOW_1';
const kinds=['VCP','RS','VOLUME','PIVOT','PORTFOLIO_RISK','SOURCE_QUALITY'] as const;
export type ShadowEvidence={kind:typeof kinds[number];revision:string;at:string;quality:'VERIFIED'|'UNKNOWN'};
export type ShadowOutcome='PASS'|'VETO'|'REVIEW_REQUIRED'|'UNAVAILABLE';
export interface ShadowReviewInput {
 mode:'DISABLED'|'SHADOW'|'ADVISORY';
 at:string;strategyVersion:string;modelVersion:string;promptVersion:string;
 evidence:readonly ShadowEvidence[];
 response:unknown;
}
const version=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function shadowReview(input:ShadowReviewInput){
 if(!instant(input.at)||!version(input.strategyVersion)||!version(input.modelVersion)||!version(input.promptVersion)||!['DISABLED','SHADOW','ADVISORY'].includes(input.mode))throw new Error('INVALID_SHADOW_CONTEXT');
 // Copy only the closed evidence schema. Never retain arbitrary model text or instructions.
 const evidence=input.evidence.map(e=>{
  if(!kinds.includes(e.kind)||!version(e.revision)||!instant(e.at)||!['VERIFIED','UNKNOWN'].includes(e.quality))throw new Error('INVALID_SHADOW_EVIDENCE');
  return {kind:e.kind,revision:e.revision,at:e.at,quality:e.quality};
 });
 let outcome:ShadowOutcome='UNAVAILABLE',reason='AI_DISABLED',responseVersion:string|null=null,responseAt:string|null=null;
 if(input.mode!=='DISABLED'){
  reason='EVIDENCE_UNAVAILABLE';
  if(kinds.every(k=>evidence.filter(e=>e.kind===k).length===1)&&evidence.length===kinds.length&&evidence.every(e=>e.quality==='VERIFIED'&&e.at<=input.at)){
   reason='INVALID_RESPONSE';
   const r=input.response;
   if(r===null||r===undefined)reason='SERVICE_UNAVAILABLE';
   else if(typeof r==='object'&&!Array.isArray(r)){
    const row=r as Record<string,unknown>;
    if(Object.keys(row).length===3&&version(row['version'])&&instant(row['at'])&&row['at']<=input.at&&evidence.every(e=>e.at<=String(row['at']))&&typeof row['outcome']==='string'&&['PASS','VETO','REVIEW_REQUIRED','UNAVAILABLE'].includes(row['outcome'])){
     outcome=row['outcome'] as ShadowOutcome;responseVersion=row['version'];responseAt=row['at'];reason=outcome==='UNAVAILABLE'?'SERVICE_UNAVAILABLE':'NONAUTHORITATIVE';
    }
   }
  }
 }
 return {contractVersion:SHADOW_CONTRACT_VERSION,mode:input.mode,at:input.at,strategyVersion:input.strategyVersion,modelVersion:input.modelVersion,promptVersion:input.promptVersion,evidence,responseVersion,responseAt,outcome,reason,authoritative:false as const};
}
