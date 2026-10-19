import {detect,type VcpSeries} from '@vcp/vcp';
import {parseFixed,utcInstant} from '@vcp/domain';
import {evaluateBreakout,type ReadySnapshot} from './signals.js';
export interface ReplayStrength {value:string;revision:string;knownAt:string;mode?:'RETROSPECTIVE_CORRECTION';session?:string;asOf?:string}
/** Retrospective reconstruction only. This never replaces an original live decision. */
export function replayStructure(input:{listingId:string;series:VcpSeries;tick:string;adjustmentRevision:string;configHash:string;decidedAt:string;strength:Readonly<Record<string,ReplayStrength>>}){
 const {series}=input;
 if(utcInstant(input.decidedAt)<utcInstant(series.asOf))throw new Error('REPLAY_DECISION_BEFORE_EVIDENCE');
 if(!series.bars.length||series.bars.some(b=>!b.finalizedAt||utcInstant(b.finalizedAt)>utcInstant(series.asOf)))throw new Error('REPLAY_UNFINALIZED_SERIES');
 let previous:ReadySnapshot|null=null;
 return series.bars.map((today,index)=>{
  const bars=series.bars.slice(0,index+1),sessions=series.sessions.slice(0,index+1),asOf=today.finalizedAt!;
  const strength=input.strength[today.session];let rs:string|null=null;
  if(strength){const value=parseFixed(strength.value,8);if(!strength.revision||value<0n||value>10000000000n)throw new Error('INVALID_REPLAY_STRENGTH');
   const retrospective=strength.mode==='RETROSPECTIVE_CORRECTION'&&strength.session===today.session&&strength.asOf!==undefined&&utcInstant(strength.asOf)<=utcInstant(asOf)&&utcInstant(strength.knownAt)<=utcInstant(input.decidedAt);
   if(retrospective||(!strength.mode&&utcInstant(strength.knownAt)<=utcInstant(asOf)))rs=strength.value;
  }
  // Consume yesterday's frozen primary before calling today's detector.
  const breakout=previous&&parseFixed(previous.pivot)%parseFixed(input.tick)!==0n
   ?{state:'UNKNOWN' as const,reasons:['ADJUSTED_PIVOT_OFF_TICK'],event:null}
   :evaluateBreakout({previous,today,priorBars:series.bars.slice(Math.max(0,index-50),index),tick:input.tick,verifiedSessions:sessions,evidence:{configHash:input.configHash,dataRevision:series.dataRevision,decidedAt:input.decidedAt},volumeScale:'ADJUSTED'});
  const structure=detect({...series,bars,sessions,asOf},{listingId:input.listingId,tick:input.tick,adjustmentRevision:input.adjustmentRevision,currentScaleFactor:'1',rs,decidedAt:input.decidedAt});
  const primary=structure.primary;
  previous=primary&&primary.stopSource?{listingId:input.listingId,patternId:primary.id,session:today.session,state:primary.state,pivot:primary.pivot,lastLow:primary.stopSource,asOf,configHash:input.configHash,dataRevision:series.dataRevision}:null;
  return {session:today.session,mode:'RETROSPECTIVE_CORRECTION' as const,asOf,decidedAt:input.decidedAt,dataRevision:series.dataRevision,rs:rs===null?{state:'UNKNOWN',value:null,revision:null}:{state:'KNOWN',value:rs,revision:strength!.revision},breakout,structure};
 });
}
