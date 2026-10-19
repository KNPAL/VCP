import {detect,type VcpSeries} from '@vcp/vcp';
import {parseFixed,utcInstant} from '@vcp/domain';
import {evaluateBreakout,type ReadySnapshot} from './signals.js';

/** Internal coordinator input. The scanner must supply verified, pinned source evidence. */
export interface DailyStructureInput {
 listingId:string;series:VcpSeries;tick:string;adjustmentRevision:string;
 /** Stable corporate-action price basis, not the changing daily candle revision. */
 scaleRevision:string;configHash:string;decidedAt:string;
 strength:{value:string;revision:string;knownAt:string}|null;
}
export interface FrozenDailyStructure {
 session:string;listingId:string;scaleRevision:string;configHash:string;decidedAt:string;
 primary:ReadySnapshot|null;
}
export function dailyBreakout(input:DailyStructureInput,previous:FrozenDailyStructure|null){
 const {series}=input,today=series.bars.at(-1);
 if(!today||series.priceScale!=='ADJUSTED'||!input.scaleRevision||!input.adjustmentRevision)throw new Error('DAILY_SERIES_REQUIRED');
 if(parseFixed(input.tick)<=0n)throw new Error('INVALID_TICK');
 if(utcInstant(series.asOf)>utcInstant(input.decidedAt))throw new Error('DAILY_DECISION_BEFORE_EVIDENCE');
 const reasons:string[]=[];
 if(previous){
  if(previous.listingId!==input.listingId||previous.session!==series.sessions.at(-2))reasons.push('PREVIOUS_SESSION_MISMATCH');
  if(previous.scaleRevision!==input.scaleRevision)reasons.push('PREVIOUS_PRICE_BASIS_CHANGED');
  if(previous.configHash!==input.configHash)reasons.push('STRATEGY_VERSION_MISMATCH');
  if(utcInstant(previous.decidedAt)>=utcInstant(today.endedAt))reasons.push('PREVIOUS_SNAPSHOT_NOT_FROZEN');
  if(previous.primary&&parseFixed(previous.primary.pivot)%parseFixed(input.tick)!==0n)reasons.push('ADJUSTED_PIVOT_OFF_TICK');
 }
 if(reasons.length)return {state:'UNKNOWN' as const,reasons,event:null};
 return evaluateBreakout({previous:previous?.primary??null,today,priorBars:series.bars.slice(-51,-1),tick:input.tick,verifiedSessions:series.sessions,evidence:{configHash:input.configHash,dataRevision:series.dataRevision,decidedAt:input.decidedAt},volumeScale:'ADJUSTED'});
}
export function detectDailyStructure(input:DailyStructureInput){
 let rs:string|null=null;
 if(input.strength){
  const value=parseFixed(input.strength.value,8);
  if(!input.strength.revision||value<0n||value>10000000000n)throw new Error('INVALID_DAILY_STRENGTH');
  if(utcInstant(input.strength.knownAt)<=utcInstant(input.series.asOf))rs=input.strength.value;
 }
 const structure=detect(input.series,{listingId:input.listingId,tick:input.tick,adjustmentRevision:input.adjustmentRevision,currentScaleFactor:'1',rs,decidedAt:input.decidedAt});
 const primary=structure.primary;
 const frozen:FrozenDailyStructure={session:input.series.sessions.at(-1)!,listingId:input.listingId,scaleRevision:input.scaleRevision,configHash:input.configHash,decidedAt:input.decidedAt,primary:primary&&primary.stopSource?{listingId:input.listingId,patternId:primary.id,session:input.series.sessions.at(-1)!,state:primary.state,pivot:primary.pivot,lastLow:primary.stopSource,asOf:input.series.asOf,configHash:input.configHash,dataRevision:input.series.dataRevision}:null};
 return {structure,frozen,rs:rs===null?{state:'UNKNOWN',reason:'VERIFIED_RS_UNAVAILABLE'}:{state:'KNOWN',value:rs,revision:input.strength!.revision}};
}
