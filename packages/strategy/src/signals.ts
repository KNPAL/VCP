import {createHash} from 'node:crypto';
import {parseFixed,formatFixed,utcInstant,sessionDate,STRATEGY_VERSION} from '@vcp/domain';
export type Gate='PASS'|'FAIL'|'UNKNOWN';
export interface SignalEvidence {configHash:string;dataRevision:string;decidedAt:string}
export interface FinalBar {session:string;close:string;volume:string;endedAt:string;finalizedAt:string|null;revision:string}
export interface ReadySnapshot {listingId:string;patternId:string;session:string;state:string;pivot:string;lastLow:string;asOf:string;configHash:string;dataRevision:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at=(value:string)=>utcInstant(value).valueOf();
const price=(value:string)=>{const n=parseFixed(value);if(n<=0n)throw new Error('INVALID_PRICE');return n};
function evidenceValid(evidence:SignalEvidence){at(evidence.decidedAt);if(!/^[0-9a-f]{64}$/.test(evidence.configHash)||!evidence.dataRevision)throw new Error('INVALID_SIGNAL_EVIDENCE')}
export function evaluateBreakout(input:{previous:ReadySnapshot|null;today:FinalBar;priorBars:readonly FinalBar[];tick:string;verifiedSessions:readonly string[]|null;evidence:SignalEvidence;volumeScale?:'RAW'|'ADJUSTED'}){
 const {previous,today,priorBars,evidence}=input;evidenceValid(evidence);sessionDate(today.session);
 const reasons:string[]=[];const now=at(evidence.decidedAt);
 if(!input.verifiedSessions||new Set(input.verifiedSessions).size!==input.verifiedSessions.length||input.verifiedSessions.some((date,i)=>{sessionDate(date);return i>0&&date<=input.verifiedSessions![i-1]!}))reasons.push('CALENDAR_UNKNOWN');
 const sessions=input.verifiedSessions??[],index=sessions.indexOf(today.session);
 if(index<50)reasons.push('VOLUME_HISTORY_INCOMPLETE');
 if(!today.finalizedAt||at(today.finalizedAt)>now||at(today.endedAt)>now||at(today.finalizedAt)<at(today.endedAt))reasons.push('CANDLE_NOT_FINAL');
 if(!previous)reasons.push('PREVIOUS_READY_MISSING');
 else {
  if(previous.session!==sessions[index-1]||previous.state!=='READY')reasons.push('PREVIOUS_NOT_READY');
  if(at(previous.asOf)>=at(today.endedAt)||at(previous.asOf)>now)reasons.push('PREVIOUS_SNAPSHOT_LOOKAHEAD');
  if(previous.configHash!==evidence.configHash)reasons.push('STRATEGY_VERSION_MISMATCH');
 }
 if(priorBars.length!==50||priorBars.some((bar,i)=>bar.session!==sessions[index-50+i]||!bar.finalizedAt||at(bar.finalizedAt)>now||at(bar.finalizedAt)<at(bar.endedAt)||at(bar.endedAt)>=at(today.endedAt)))reasons.push('VOLUME_HISTORY_INCOMPLETE');
 if(reasons.length)return {state:'UNKNOWN' as const,reasons,event:null};
 const frozen=previous!,pivot=price(frozen.pivot),close=price(today.close),priorClose=price(priorBars.at(-1)!.close),tick=price(input.tick);
 if(pivot%tick!==0n)throw new Error('PIVOT_OFF_TICK');price(frozen.lastLow);
 if(close<=pivot||priorClose>pivot)return {state:'NO_CROSS' as const,reasons:['NO_COMPLETED_PRICE_CROSS'],event:null};
 const volume=(value:string)=>{if(input.volumeScale==='ADJUSTED'){const n=parseFixed(value,8,24);if(n<0n)throw new Error('INVALID_VOLUME');return n}if(!/^(0|[1-9]\d*)$/.test(value))throw new Error('INVALID_VOLUME');return BigInt(value)};
 const sum=priorBars.reduce((total,bar)=>total+volume(bar.volume),0n),current=volume(today.volume);
 if(sum===0n)return {state:'UNKNOWN' as const,reasons:['VOLUME_BASELINE_ZERO'],event:null};
 const confirmed=current*100n>=sum*3n;
 const state=confirmed?'BREAKOUT_CONFIRMED' as const:'BREAKOUT_PRICE_ONLY' as const;
 const logicalId=hash([frozen.listingId,today.session,(pivot/tick).toString()]);
 const event={id:hash([logicalId,evidence.configHash,evidence.dataRevision]),logicalId,type:state,listingId:frozen.listingId,patternId:frozen.patternId,session:today.session,pivot:frozen.pivot,lastLow:frozen.lastLow,close:today.close,
  rvol:{numerator:(current*50n).toString(),denominator:sum.toString()},...(input.volumeScale==='ADJUSTED'?{volumeScale:'ADJUSTED' as const}:{}),reasons:confirmed?[]:['BREAKOUT_VOLUME_BELOW_1_50'],
  occurredAt:today.endedAt,observedAt:today.finalizedAt!,decidedAt:evidence.decidedAt,effectiveAt:evidence.decidedAt,
  strategyVersion:STRATEGY_VERSION,configHash:evidence.configHash,dataRevision:evidence.dataRevision,
  sourceRevisions:[...priorBars.map(bar=>bar.revision),today.revision],previousSnapshot:frozen};
 return {state,reasons:event.reasons,event};
}
export type MarketEvent=NonNullable<ReturnType<typeof evaluateBreakout>['event']>;
/** Call the frozen-state evaluation before any detector work using today's candle. */
export async function breakoutBeforeRecompute<T>(input:Parameters<typeof evaluateBreakout>[0],persist:(event:MarketEvent)=>Promise<unknown>,recompute:()=>Promise<T>){
 const breakout=evaluateBreakout(input);if(breakout.event)await persist(breakout.event);
 return {breakout,candidates:await recompute()};
}
export function structuralStop(lastLow:string,tickValue:string,entryValue:string){
 const low=price(lastLow),tick=price(tickValue),entry=price(entryValue);
 const stop=(low-tick)/tick*tick;
 const reasons:string[]=[];if(low<=tick||stop<=0n)reasons.push('INVALID_STRUCTURAL_STOP');
 if(stop>=entry)reasons.push('STOP_NOT_BELOW_ENTRY');
 if(stop<entry&&(entry-stop)*100n>entry*8n)reasons.push('STOP_WIDER_THAN_8_PERCENT');
 return {stop:formatFixed(stop),riskPerShare:formatFixed(entry-stop),reasons};
}
export interface EntrySession {date:string;opensAt:string;closesAt:string}
export const REQUIRED_RISK_GATES=['POSITION_CAP','CASH','LOSS_STREAK','STOCK_CAP','SECTOR_CAP','OPEN_RISK_CAP','GROSS_CAP','PER_TRADE_RISK'] as const;
export interface EntryInput {
 event:MarketEvent;now:string;calendar:readonly EntrySession[]|null;continuousMarket:Gate;
 quote:{price:string;at:string}|null;heartbeatAt:string|null;brokerConnected:Gate;sessionValid:Gate;tokenValid:Gate;brokerSettled:Gate;
 gates:{G04:Gate;G05:Gate;G06:Gate;G08:Gate};riskGates:Record<string,Gate>|null;regime:'GREEN'|'YELLOW'|'RED'|'UNKNOWN';tick:string;
}
export function evaluateEntry(input:EntryInput){
 const now=at(input.now),reasons:string[]=[];const event=input.event;
 if(event.type!=='BREAKOUT_CONFIRMED')reasons.push('MARKET_SIGNAL_NOT_CONFIRMED');
 if(at(event.decidedAt)>now)reasons.push('SIGNAL_NOT_YET_KNOWN');
 const sessions=input.calendar;
 if(!sessions)reasons.push('CALENDAR_UNKNOWN');
 else {
  for(let i=0;i<sessions.length;i++){const session=sessions[i]!;sessionDate(session.date);if(at(session.opensAt)>=at(session.closesAt)||(i>0&&(sessions[i-1]!.date>=session.date||at(sessions[i-1]!.closesAt)>=at(session.opensAt))))throw new Error('INVALID_ENTRY_CALENDAR')}
  const signalIndex=sessions.findIndex(s=>s.date===event.session),current=sessions.findIndex(s=>at(s.opensAt)<=now&&now<at(s.closesAt));
  if(signalIndex<0||sessions.length<signalIndex+3)reasons.push('CALENDAR_INCOMPLETE');
  else if(now>=at(sessions[signalIndex+2]!.closesAt))reasons.push('ENTRY_WINDOW_EXPIRED');
  else if(current!==signalIndex+1&&current!==signalIndex+2)reasons.push('OUTSIDE_ENTRY_SESSION');
 }
 const gate=(name:string,value:Gate)=>{if(value!=='PASS')reasons.push(name+'_'+(value==='FAIL'?'FAILED':'UNKNOWN'))};
 gate('CONTINUOUS_MARKET',input.continuousMarket);gate('BROKER_CONNECTED',input.brokerConnected);gate('SESSION',input.sessionValid);gate('TOKEN',input.tokenValid);gate('BROKER_SETTLED',input.brokerSettled);
 for(const name of ['G04','G05','G06','G08'] as const)gate(name,input.gates[name]);
 for(const name of REQUIRED_RISK_GATES)gate(name,input.riskGates?.[name]??'UNKNOWN');
 if(input.regime!=='GREEN'&&input.regime!=='YELLOW')reasons.push('REGIME_'+input.regime);
 if(!input.heartbeatAt||now-at(input.heartbeatAt)>30000||now<at(input.heartbeatAt))reasons.push('HEARTBEAT_STALE');
 let stop:string|null=null;
 if(!input.quote)reasons.push('QUOTE_UNKNOWN');
 else {
  if(now-at(input.quote.at)>60000||now<at(input.quote.at))reasons.push('QUOTE_STALE');
  const current=price(input.quote.price),pivot=price(event.pivot);
  if(current<=pivot)reasons.push('NO_LONGER_ABOVE_PIVOT');
  if(current*100n>pivot*103n)reasons.push('MISSED_ENTRY');
  const structural=structuralStop(event.lastLow,input.tick,input.quote.price);stop=structural.stop;reasons.push(...structural.reasons);
 }
 return {id:hash([event.id,input]),marketEventId:event.id,state:reasons.length?'BUY_BLOCKED' as const:'BUY_ELIGIBLE' as const,reasons,stop,quote:input.quote,
  decidedAt:input.now,expiresAt:new Date(now+30000).toISOString(),configHash:event.configHash,dataRevision:event.dataRevision,strategyVersion:event.strategyVersion,
  evidence:input};
}
export type UserSignalDecision=ReturnType<typeof evaluateEntry>;
