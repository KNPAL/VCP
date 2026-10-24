import {parseFixed,formatFixed,utcInstant,exchangeDate} from '@vcp/domain';
import {positionEpisodes,type LossCalendarDay} from '@vcp/portfolio';
import {configurationHash} from '@vcp/strategy';
import {verifiedCalendar} from '@vcp/market-data';
import {readPaperLedger,type PaperLedger} from './paper-ledger.js';
import type {HistoricalInputs} from './index.js';

export interface PerformanceDay {
 session:string;asOf:string;
 marks:readonly {isin:string;price:string;sourceAt:string;knownAt:string;sourceReference:string}[];
 regime:{state:'GREEN'|'YELLOW'|'RED'|'UNKNOWN';knownAt:string;revision:string}|null;
}
export interface PerformanceInput {
 ledger:PaperLedger;asOf:string;calendar:readonly LossCalendarDay[];days:readonly PerformanceDay[];
 initialRisks:readonly {episodeId:string;riskAmount:string;knownAt:string;regime?:'GREEN'|'YELLOW'|'RED'|'UNKNOWN'}[];
 signals:readonly {id:string;decidedAt:string}[];
 entryDecisions:readonly {id:string;marketEventId:string;decidedAt:string;state:string}[];
 /** Absent means manual execution was not compared; zero is never inferred. */
 manualExecution:{matchedSignalIds:readonly string[];asOf:string;sourceReference:string}|null;
 fees:HistoricalInputs['fees']|null;bias:string|null;limitations:readonly string[];
}
const at=(value:string)=>utcInstant(value).valueOf(),ratio=(n:bigint,d:bigint)=>d===0n?null:formatFixed(n*1000000n/d);
export function paperPerformance(input:PerformanceInput){
 const cutoff=at(input.asOf),state=readPaperLedger(input.ledger,input.asOf,input.calendar),reasons=[...input.limitations];
 const capital=input.ledger.events.find(event=>event.kind==='INITIAL_CAPITAL');
 if(!capital||capital.kind!=='INITIAL_CAPITAL'||at(capital.recordedAt)>cutoff)throw new Error('PERFORMANCE_CAPITAL_UNAVAILABLE');
 const initial=parseFixed(capital.amount);if(initial<=0n)throw new Error('PERFORMANCE_CAPITAL_UNAVAILABLE');
 if(!input.fees?.sourceReference)reasons.push('COSTS_UNCONFIGURED');
 else for(const field of ['buyBps','sellBps','slippageBps','minimumFee'] as const)if(parseFixed(input.fees[field])<0n)throw new Error('INVALID_PERFORMANCE_COSTS');
 if(new Set(input.initialRisks.map(row=>row.episodeId)).size!==input.initialRisks.length)throw new Error('DUPLICATE_INITIAL_RISK');
 const episodes=positionEpisodes(input.ledger.events,input.asOf,[],input.ledger.corporateActions).episodes;
 const trades=episodes.filter(row=>row.closedAt!==null).map(episode=>{
  const risk=input.initialRisks.find(row=>row.episodeId===episode.id),amount=risk&&at(risk.knownAt)<=at(episode.openedAt)?parseFixed(risk.riskAmount):null;
  if(amount===null||amount<=0n)reasons.push('INITIAL_R_UNAVAILABLE:'+episode.id);
  const pnl=episode.netPnl===null?null:parseFixed(episode.netPnl);
  return {...episode,entryRegime:risk&&at(risk.knownAt)<=at(episode.openedAt)?risk.regime??'UNKNOWN':'UNKNOWN',initialRisk:amount!==null&&amount>0n?formatFixed(amount):null,rMultiple:amount!==null&&amount>0n&&pnl!==null?ratio(pnl,amount):null};
 });
 const complete=trades.every(row=>row.netPnl!==null),pnls=trades.map(row=>row.netPnl===null?0n:parseFixed(row.netPnl));
 const wins=pnls.filter(n=>n>0n).length,losses=pnls.filter(n=>n<0n).length,neutral=pnls.filter(n=>n===0n).length;
 const profits=pnls.filter(n=>n>0n).reduce((a,b)=>a+b,0n),loss=pnls.filter(n=>n<0n).reduce((a,b)=>a-b,0n);
 const days=[...input.days].filter(day=>at(day.asOf)<=cutoff).sort((a,b)=>a.session.localeCompare(b.session));
 if(new Set(days.map(day=>day.session)).size!==days.length)throw new Error('DUPLICATE_PERFORMANCE_SESSION');
 const expected=input.calendar.filter(day=>day.kind!=='HOLIDAY'&&day.date>=exchangeDate(capital.occurredAt)&&day.date<=exchangeDate(input.asOf)&&day.finalizedAt&&at(day.finalizedAt)<=cutoff);
 let curveComplete=true,peak=initial,maxDrawdown=0n,previous:bigint|null=initial,lastIndex=-1;
 try{if(verifiedCalendar(input.calendar,exchangeDate(capital.occurredAt),exchangeDate(input.asOf),input.asOf).state!=='KNOWN'){curveComplete=false;reasons.push('VALUATION_CALENDAR_UNKNOWN')}}catch{curveComplete=false;reasons.push('VALUATION_CALENDAR_INVALID')}
 for(const day of expected)if(!days.some(row=>row.session===day.date)){reasons.push('VALUATION_SESSION_MISSING:'+day.date);curveComplete=false}
 const curve=days.map(day=>{
  const calendar=input.calendar.find(row=>row.date===day.session),issues:string[]=[];
  const index=expected.findIndex(row=>row.date===day.session);if(index>lastIndex+1)previous=null;lastIndex=index;
  if(exchangeDate(day.asOf)!==day.session||!calendar?.verified||!calendar.source||at(calendar.knownAt)>at(day.asOf)||!calendar.finalizedAt||at(calendar.finalizedAt)>at(day.asOf)||calendar.kind==='HOLIDAY')issues.push('VALUATION_SESSION_UNVERIFIED');
  if(new Set(day.marks.map(row=>row.isin)).size!==day.marks.length)throw new Error('DUPLICATE_PERFORMANCE_MARK');
  const portfolio=readPaperLedger(input.ledger,day.asOf,input.calendar).portfolio;
  let gross=0n;
  for(const [isin,quantity] of Object.entries(portfolio.holdings)){
   const mark=day.marks.find(row=>row.isin===isin);
   if(!mark||!mark.sourceReference||exchangeDate(mark.sourceAt)!==day.session||at(mark.sourceAt)>at(day.asOf)||at(mark.knownAt)>at(day.asOf)||at(mark.knownAt)<at(mark.sourceAt)){issues.push('MARK_UNAVAILABLE:'+isin);continue}
   const price=parseFixed(mark.price);if(price<=0n)throw new Error('INVALID_PERFORMANCE_MARK');gross+=price*BigInt(quantity);
  }
  const equity=issues.length||portfolio.cash===null?null:parseFixed(portfolio.cash)+gross;
  const regime=day.regime&&day.regime.revision&&at(day.regime.knownAt)<=at(day.asOf)?day.regime.state:'UNKNOWN';
  if(regime==='UNKNOWN')reasons.push('REGIME_UNKNOWN:'+day.session);
  const drawdown=equity===null?null:(peak>equity?(peak-equity)*1000000n/peak:0n);
  if(drawdown!==null&&drawdown>maxDrawdown)maxDrawdown=drawdown;
  if(equity!==null&&equity>peak)peak=equity;
  if(equity===null){curveComplete=false;reasons.push(...issues.map(reason=>reason+':'+day.session))}
  const result={session:day.session,asOf:day.asOf,regime,cash:portfolio.cash,equity:equity===null?null:formatFixed(equity),grossExposure:issues.length?null:formatFixed(gross),exposureFraction:equity!==null&&equity>0n?ratio(gross,equity):null,dailyReturn:equity!==null&&previous!==null&&previous>0n?ratio(equity-previous,previous):null,compoundedReturn:equity===null?null:ratio(equity-initial,initial),drawdown:drawdown===null?null:formatFixed(drawdown),reasons:issues};
  previous=equity;return result;
 });
 const signals=input.signals.filter(row=>at(row.decidedAt)<=cutoff),decisions=input.entryDecisions.filter(row=>at(row.decidedAt)<=cutoff);
 if(new Set(signals.map(row=>row.id)).size!==signals.length||new Set(decisions.map(row=>row.id)).size!==decisions.length)throw new Error('DUPLICATE_PERFORMANCE_EVIDENCE');
 const filled=new Set(decisions.filter(row=>row.state==='SIMULATED_FILL').map(row=>row.marketEventId));
 if(input.manualExecution&&(!input.manualExecution.sourceReference||!Array.isArray(input.manualExecution.matchedSignalIds)||input.manualExecution.matchedSignalIds.some(id=>typeof id!=='string'||!id)||new Set(input.manualExecution.matchedSignalIds).size!==input.manualExecution.matchedSignalIds.length))throw new Error('INVALID_MANUAL_COMPARISON');
 const manual=input.manualExecution&&input.manualExecution.sourceReference&&at(input.manualExecution.asOf)<=cutoff?new Set(input.manualExecution.matchedSignalIds):null;
 if(!manual)reasons.push('MANUAL_EXECUTION_NOT_LINKED');
 const body={asOf:input.asOf,ledgerRevision:input.ledger.revision,closedTrades:trades.length,wins:complete?wins:null,losses:complete?losses:null,neutral:complete?neutral:null,winRate:complete&&trades.length?ratio(BigInt(wins),BigInt(trades.length)):null,netRealizedPnl:state.portfolio.realizedPnl,netClosedPnl:complete?formatFixed(pnls.reduce((a,b)=>a+b,0n)):null,profitFactor:complete&&loss>0n?ratio(profits,loss):null,expectancyR:trades.length&&trades.every(row=>row.rMultiple!==null)?formatFixed(trades.reduce((sum,row)=>sum+parseFixed(row.rMultiple!),0n)/BigInt(trades.length)):null,maxDrawdown:curveComplete?formatFixed(maxDrawdown):null,observedDrawdown:formatFixed(maxDrawdown),curve,trades,openPositions:state.portfolio.positions,blockedEntries:decisions.filter(row=>['BUY_BLOCKED','MISSED'].includes(row.state)).length,signalCount:signals.length,signalPaperExecutionGap:signals.filter(row=>!filled.has(row.id)).length,signalManualExecutionGap:manual?signals.filter(row=>!manual.has(row.id)).length:null,bias:input.bias,costs:input.fees,limitations:[...new Set(reasons)],state:reasons.includes('COSTS_UNCONFIGURED')?'COSTS_UNCONFIGURED':curveComplete&&complete?'COMPUTED':'INCOMPLETE',executable:false,performanceVerified:false};
 const regimes=['GREEN','YELLOW','RED','UNKNOWN'].map(regime=>{
  const selected=trades.filter(row=>row.entryRegime===regime),known=selected.every(row=>row.netPnl!==null),values=selected.map(row=>row.netPnl===null?0n:parseFixed(row.netPnl));
  return {regime,closedTrades:selected.length,wins:known?values.filter(value=>value>0n).length:null,netClosedPnl:known?formatFixed(values.reduce((a,b)=>a+b,0n)):null,winRate:known&&selected.length?ratio(BigInt(values.filter(value=>value>0n).length),BigInt(selected.length)):null,expectancyR:selected.length&&selected.every(row=>row.rMultiple!==null)?formatFixed(selected.reduce((sum,row)=>sum+parseFixed(row.rMultiple!),0n)/BigInt(selected.length)):null};
 });
 const comparison=manual?input.manualExecution:null;
 return {id:configurationHash({...body,regimes,comparison}),...body,regimes,comparison};
}
