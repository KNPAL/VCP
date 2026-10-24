import {exchangeDate,formatFixed,parseFixed,utcInstant} from '@vcp/domain';
import {projectPortfolio,adjustedShareQuantity,type PortfolioEvent,type ShareAdjustment} from './ledger.js';
export interface CashAllocation {cashEventId:string;episodeId:string;recordedAt:string}
export interface LossCalendarDay {date:string;kind:'TRADING'|'SPECIAL'|'HOLIDAY';opensAt:string|null;closesAt:string|null;finalizedAt:string|null;knownAt:string;source:string;verified:boolean}
const at=(value:string)=>utcInstant(value).valueOf();
export function positionEpisodes(events:readonly PortfolioEvent[],asOf:string,allocations:readonly CashAllocation[]=[],corporateActions:readonly ShareAdjustment[]=[]){
 const journal=projectPortfolio(events,asOf,corporateActions),visible=events.filter(e=>at(e.recordedAt)<=at(asOf)&&at(e.occurredAt)<=at(asOf)),byId=new Map(visible.map(e=>[e.id,e]));
 const root=(e:PortfolioEvent):PortfolioEvent=>e.kind==='FILL'&&e.replacementOf?root(byId.get(e.replacementOf)!):e;
 const fills=visible.filter((e):e is Extract<PortfolioEvent,{kind:'FILL'}>=>e.kind==='FILL'&&!journal.reversed.includes(e.id)).sort((a,b)=>at(a.occurredAt)-at(b.occurredAt)||root(a).sequence-root(b).sequence);
 type Episode={id:string;isin:string;openedAt:string;closedAt:string|null;closeSequence:number|null;knownAt:string;quantity:number;tradeCash:bigint;extraCash:bigint;fillIds:string[];cashEventIds:string[]};
 const episodes:Episode[]=[],open=new Map<string,Episode>();
 const actions=corporateActions.filter(action=>at(action.recordedAt)<=at(asOf)&&at(action.occurredAt)<=at(asOf)).sort((a,b)=>at(a.occurredAt)-at(b.occurredAt)||a.id.localeCompare(b.id));let actionIndex=0;
 const applyThrough=(until:string)=>{while(actionIndex<actions.length&&at(actions[actionIndex]!.occurredAt)<=at(until)){const action=actions[actionIndex++]!,episode=open.get(action.isin);if(episode){episode.quantity=adjustedShareQuantity(episode.quantity,action);if(at(action.recordedAt)>at(episode.knownAt))episode.knownAt=action.recordedAt}}};
 for(const fill of fills){
  applyThrough(fill.occurredAt);
  let episode=open.get(fill.isin);
  if(!episode){if(fill.side!=='BUY')throw new Error('INVALID_EPISODE');episode={id:root(fill).id,isin:fill.isin,openedAt:fill.occurredAt,closedAt:null,closeSequence:null,knownAt:fill.recordedAt,quantity:0,tradeCash:0n,extraCash:0n,fillIds:[],cashEventIds:[]};episodes.push(episode);open.set(fill.isin,episode)}
  episode.quantity+=fill.side==='BUY'?fill.quantity:-fill.quantity;
  episode.tradeCash+=(fill.side==='BUY'?-1n:1n)*parseFixed(fill.price)*BigInt(fill.quantity)-parseFixed(fill.fees);
  episode.fillIds.push(fill.id);if(at(fill.recordedAt)>at(episode.knownAt))episode.knownAt=fill.recordedAt;
  if(episode.quantity===0){episode.closedAt=fill.occurredAt;episode.closeSequence=root(fill).sequence;open.delete(fill.isin)}
 }
 applyThrough(asOf);
 const costs=visible.filter(e=>['FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT'].includes(e.kind)),unallocated:string[]=[];
 const assignments=new Map<string,CashAllocation>();
 for(const allocation of allocations){if(at(allocation.recordedAt)>at(asOf))continue;if(assignments.has(allocation.cashEventId))throw new Error('DUPLICATE_CASH_ALLOCATION');assignments.set(allocation.cashEventId,allocation)}
 for(const allocation of assignments.values())if(!costs.some(e=>e.id===allocation.cashEventId))throw new Error('INVALID_CASH_ALLOCATION');
 for(const event of costs){
  if(event.kind==='FILL'||event.kind==='REVERSAL')continue;
  const allocation=assignments.get(event.id);
  if(!allocation){unallocated.push(event.id);continue}
  const episode=episodes.find(e=>e.id===allocation.episodeId);
  if(!episode||at(event.occurredAt)<at(episode.openedAt)||at(allocation.recordedAt)<at(event.recordedAt))throw new Error('INVALID_CASH_ALLOCATION');
  episode.extraCash+=parseFixed(event.amount)*(event.kind==='FEE'||event.kind==='CORPORATE_DEBIT'?-1n:1n);episode.cashEventIds.push(event.id);
  if(at(allocation.recordedAt)>at(episode.knownAt))episode.knownAt=allocation.recordedAt;
 }
 return {episodes:episodes.map(({tradeCash,extraCash,...e})=>({...e,tradeCash:formatFixed(tradeCash),attributedCash:formatFixed(extraCash),netPnl:e.closedAt&&unallocated.length===0?formatFixed(tradeCash+extraCash):null})),unallocated,initialCapitalKnown:journal.cash!==null};
}
function nextSession(calendar:readonly LossCalendarDay[]|null,triggerAt:string,asOf:string){
 try{
  if(!calendar)return null;
  const dates=new Map(calendar.map(d=>[d.date,d]));if(dates.size!==calendar.length)return null;
  const triggerDate=exchangeDate(triggerAt),next=[...calendar].sort((a,b)=>a.date.localeCompare(b.date)).find(d=>d.date>triggerDate&&d.kind!=='HOLIDAY');
  if(!next)return null;
  for(let date=triggerDate;date<=next.date;date=new Date(at(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
   const day=dates.get(date);if(!day?.verified||!day.source||at(day.knownAt)>at(asOf))return null;
   if(day.kind==='HOLIDAY'){if(day.opensAt||day.closesAt||day.finalizedAt)return null}
   else if(!['TRADING','SPECIAL'].includes(day.kind)||!day.opensAt||!day.closesAt||at(day.opensAt)>=at(day.closesAt)||exchangeDate(day.opensAt)!==date||exchangeDate(day.closesAt)!==date||day.finalizedAt&&at(day.finalizedAt)<at(day.closesAt))return null;
  }
  return {session:next.date,resetAt:next.finalizedAt};
 }catch{return null}
}
export function lossStreak(input:{events:readonly PortfolioEvent[];allocations?:readonly CashAllocation[];corporateActions?:readonly ShareAdjustment[];calendar:readonly LossCalendarDay[]|null;asOf:string;source:'REAL'|'PAPER'}){
 if(!['REAL','PAPER'].includes(input.source))throw new Error('INVALID_STREAK_SOURCE');
 if(input.source==='REAL'&&input.corporateActions?.length)throw new Error('PAPER_SHARE_ACTIONS_ONLY');
 const history=positionEpisodes(input.events,input.asOf,input.allocations,input.corporateActions),closed=history.episodes.filter(e=>e.closedAt!==null).sort((a,b)=>at(a.closedAt!)-at(b.closedAt!)||a.closeSequence!-b.closeSequence!);
 const reasons:string[]=[];if(!history.initialCapitalKnown)reasons.push('INITIAL_CAPITAL_REQUIRED');
 if(history.unallocated.length)reasons.push('POSITION_CASH_ATTRIBUTION_REQUIRED');
 let streak=0,knownAt=0,cooldown:{triggerEpisodeId:string;triggerAt:string;session:string|null;resetAt:string|null}|null=null;
 const transitions:{episodeId:string;kind:string;at:string}[]=[];
 if(!reasons.length)for(const episode of closed){
  knownAt=Math.max(knownAt,at(episode.knownAt));
  if(cooldown){
   if(!cooldown.resetAt||at(episode.closedAt!)<at(cooldown.resetAt)){transitions.push({episodeId:episode.id,kind:'CLOSED_DURING_COOLDOWN',at:episode.knownAt});continue}
   transitions.push({episodeId:cooldown.triggerEpisodeId,kind:'COOLDOWN_COMPLETED',at:cooldown.resetAt});streak=0;cooldown=null;
  }
  streak=parseFixed(episode.netPnl!)<0n?streak+1:0;
  transitions.push({episodeId:episode.id,kind:streak?'CLOSED_NET_LOSS':'NON_LOSS_RESET',at:episode.knownAt});
  if(streak===3){
   const triggerAt=new Date(Math.max(knownAt,at(episode.closedAt!))).toISOString(),session=nextSession(input.calendar,triggerAt,input.asOf);
   cooldown={triggerEpisodeId:episode.id,triggerAt,session:session?.session??null,resetAt:session?.resetAt??null};
  }
 }
 if(cooldown?.resetAt&&at(cooldown.resetAt)<=at(input.asOf)){transitions.push({episodeId:cooldown.triggerEpisodeId,kind:'COOLDOWN_COMPLETED',at:cooldown.resetAt});streak=0;cooldown=null}
 if(cooldown){reasons.push('LOSS_STREAK_COOLDOWN');if(!cooldown.session)reasons.push('COOLDOWN_CALENDAR_UNKNOWN');else if(!cooldown.resetAt)reasons.push('COOLDOWN_SESSION_NOT_FINAL')}
 const state=history.unallocated.length||!history.initialCapitalKnown?'UNKNOWN':cooldown?'COOLDOWN':'PASS';
 return {source:input.source,state,pass:state==='UNKNOWN'?null:state==='PASS',streak:state==='UNKNOWN'?null:streak,asOf:input.asOf,cooldown,reasons,episodes:history.episodes,unallocatedCashEventIds:history.unallocated,transitions,executable:false};
}
