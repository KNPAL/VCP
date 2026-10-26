import {utcInstant,parseFixed} from '@vcp/domain';
import {sourcePermission,surveillance,type SourceRecord} from './readiness.js';
export interface SmeResearchEvidence {
 listingId:string;isin:string;exchange:'NSE'|'BSE';segment:'SME';exchangeSegmentCode:string;segmentVerified:boolean;
 lot:number|null;lotVerified:boolean;knownAt:string;source:SourceRecord;
 restrictions:Parameters<typeof surveillance>[0];thinExecutionAssumptions:string[];
}
export function validateSmeResearch(value:SmeResearchEvidence){
 if(!value||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.listingId)||!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.isin)||!['NSE','BSE'].includes(value.exchange)||value.segment!=='SME'||typeof value.exchangeSegmentCode!=='string'||! /^[A-Z0-9_-]{1,20}$/.test(value.exchangeSegmentCode)||typeof value.segmentVerified!=='boolean'||typeof value.lotVerified!=='boolean'||value.lot!==null&&(!Number.isSafeInteger(value.lot)||value.lot<=0)||!Array.isArray(value.thinExecutionAssumptions)||value.thinExecutionAssumptions.some(s=>typeof s!=='string'||!s.trim()||s.length>1000))throw new Error('INVALID_SME_RESEARCH');
 if(!value.source||value.lotVerified&&value.lot===null||value.restrictions&&[value.restrictions.asm,value.restrictions.gsm,value.restrictions.esm,value.restrictions.cashTradable].some(v=>v!==null&&typeof v!=='boolean'))throw new Error('INVALID_SME_RESEARCH');
 utcInstant(value.knownAt);sourcePermission(value.source,'DISPLAY',value.knownAt);surveillance(value.restrictions,value.knownAt);return value;
}
export function smeResearch(evidence:SmeResearchEvidence|null,input:{asOf:string;liquidity:string|null;liquiditySourceAt:string|null;actionRevision:string|null;actionSourceAt:string|null}){
 utcInstant(input.asOf);const reasons=['RESEARCH_ONLY_NO_BUY','NO_GUARANTEED_OHLC_FILL'];
 const unavailable={state:'UNKNOWN',segment:null,lot:null,liquidity:null,restrictions:null,actionRevision:null,assumptions:[] as string[]};
 const base={validUntil:evidence?.source?.validUntil??input.asOf,profile:'SME_RESEARCH_ONLY_V1',asOf:input.asOf,buyState:'BUY_BLOCKED',buyEligible:false,executable:false,guaranteedFill:false};
 if(!evidence)return {...base,...unavailable,reasons:[...reasons,'SME_SOURCE_UNAVAILABLE']};
 validateSmeResearch(evidence);
 const display=sourcePermission(evidence.source,'DISPLAY',input.asOf),derive=sourcePermission(evidence.source,'DERIVE',input.asOf);
 if(utcInstant(evidence.knownAt)>utcInstant(input.asOf)||display.status!=='PASS'||derive.status!=='PASS'||evidence.source.coverage.available<1)return {...base,...unavailable,reasons:[...reasons,'SME_SOURCE_UNAVAILABLE_OR_NOT_PERMITTED',...display.reasons,...derive.reasons]};
 const restricted=surveillance(evidence.restrictions,input.asOf),restrictionsCurrent=!restricted.reasons.includes('SURVEILLANCE_STALE_OR_UNVERIFIED');
 if(!evidence.segmentVerified)reasons.push('SME_SEGMENT_UNVERIFIED');
 if(!evidence.lotVerified||evidence.lot===null)reasons.push('SME_LOT_UNKNOWN');
 const liquidityKnown=input.liquidity!==null&&parseFixed(input.liquidity)>=0n&&!!input.liquiditySourceAt&&utcInstant(input.liquiditySourceAt)<=utcInstant(input.asOf);
 if(liquidityKnown&&parseFixed(input.liquidity!)===0n)reasons.push('SME_NO_OBSERVED_LIQUIDITY');
 if(!liquidityKnown)reasons.push('SME_LIQUIDITY_UNKNOWN');
 if(!input.actionRevision||!input.actionSourceAt||utcInstant(input.actionSourceAt)>utcInstant(input.asOf))reasons.push('SME_ACTION_DATA_UNKNOWN');
 if(!evidence.thinExecutionAssumptions.length)reasons.push('SME_THIN_EXECUTION_ASSUMPTIONS_MISSING');
 reasons.push(...restricted.reasons);
 return {...base,validUntil:new Date(Math.min(Date.parse(evidence.source.validUntil),...(evidence.restrictions?[Date.parse(evidence.restrictions.validUntil)]:[]))).toISOString(),sourceAt:evidence.source.asOf,state:restricted.status==='FAIL'&&restrictionsCurrent||reasons.includes('SME_NO_OBSERVED_LIQUIDITY')?'RESTRICTED':reasons.length>2?'UNKNOWN':'RESEARCH_OBSERVATION',segment:evidence.segmentVerified?`${evidence.exchange} SME (${evidence.exchangeSegmentCode})`:null,lot:evidence.lotVerified?evidence.lot:null,liquidity:reasons.includes('SME_LIQUIDITY_UNKNOWN')?null:input.liquidity,liquiditySourceAt:liquidityKnown?input.liquiditySourceAt:null,restrictions:restricted.status==='UNKNOWN'||!restrictionsCurrent?null:evidence.restrictions,actionRevision:reasons.includes('SME_ACTION_DATA_UNKNOWN')?null:input.actionRevision,actionSourceAt:reasons.includes('SME_ACTION_DATA_UNKNOWN')?null:input.actionSourceAt,assumptions:evidence.thinExecutionAssumptions,reasons};
}
