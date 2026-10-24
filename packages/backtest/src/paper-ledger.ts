import {parseFixed,utcInstant} from '@vcp/domain';
import {configurationHash} from '@vcp/strategy';
import {projectPortfolio,lossStreak,valuePortfolio,type PortfolioEvent,type LossCalendarDay,type ShareAdjustment} from '@vcp/portfolio';
import {simulateOpeningEntry,type HistoricalEntryInput} from './entry-fill.js';

export interface PaperLedger {runId:string;revision:string;events:readonly PortfolioEvent[];corporateActions?:readonly ShareAdjustment[];source:'PAPER';executable:false}
export interface PaperFill {
 id:string;expectedLedgerRevision:string;isin:string;side:'BUY'|'SELL';quantity:number;price:string;fees:string;
 modeledAt:string;decidedAt:string;sourceDecisionId:string;simulated:true;executable:false;
}
const uuid=(value:unknown)=>{const h=configurationHash(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32)};
const seal=(runId:string,events:readonly PortfolioEvent[],corporateActions:readonly ShareAdjustment[]=[]):PaperLedger=>({runId,revision:configurationHash({runId,events,corporateActions}),events:structuredClone(events),corporateActions:structuredClone(corporateActions),source:'PAPER',executable:false});
export function createPaperLedger(runId:string,initialCapital:string,startedAt:string):PaperLedger {
 if(!runId||parseFixed(initialCapital)<=0n)throw new Error('PAPER_CAPITAL_REQUIRED');utcInstant(startedAt);
 const events:PortfolioEvent[]=[{id:uuid({runId,kind:'INITIAL_CAPITAL'}),sequence:1,occurredAt:startedAt,recordedAt:startedAt,sourceId:runId,author:'PAPER_SIMULATOR',kind:'INITIAL_CAPITAL',amount:initialCapital,verified:true}];
 projectPortfolio(events,startedAt);return seal(runId,events);
}
function verify(ledger:PaperLedger){if(ledger.source!=='PAPER'||ledger.executable!==false||ledger.revision!==configurationHash({runId:ledger.runId,events:ledger.events,...(ledger.corporateActions?{corporateActions:ledger.corporateActions}:{})}))throw new Error('PAPER_LEDGER_INTEGRITY_FAILED')}
/** CAS plus decision identity prevents a retry or stale fill from spending simulated cash twice. */
export function appendPaperFill(ledger:PaperLedger,fill:PaperFill):PaperLedger {
 verify(ledger);
 if(fill.simulated!==true||fill.executable!==false||!fill.id||!fill.sourceDecisionId)throw new Error('SIMULATED_DECISION_REQUIRED');
 const id=uuid({runId:ledger.runId,fillId:fill.id}),prior=ledger.events.find(event=>event.id===id);
 const event:PortfolioEvent={id,sequence:prior?.sequence??ledger.events.length+1,occurredAt:fill.modeledAt,recordedAt:fill.decidedAt,sourceId:fill.sourceDecisionId,author:'PAPER_SIMULATOR',kind:'FILL',isin:fill.isin,side:fill.side,quantity:fill.quantity,price:fill.price,fees:fill.fees,brokerReference:'PAPER:'+fill.id};
 if(prior){if(configurationHash(prior)!==configurationHash(event))throw new Error('PAPER_FILL_RETRY_CONFLICT');return structuredClone(ledger)}
 if(fill.expectedLedgerRevision!==ledger.revision)throw new Error('PAPER_LEDGER_REVISION_CONFLICT');
 if(utcInstant(fill.decidedAt)<utcInstant(ledger.events.at(-1)!.recordedAt))throw new Error('PAPER_DECISIONS_NOT_CHRONOLOGICAL');
 if(ledger.corporateActions?.some(action=>utcInstant(action.recordedAt)>utcInstant(fill.decidedAt)))throw new Error('PAPER_DECISIONS_NOT_CHRONOLOGICAL');
 const events=[...ledger.events,event],projection=projectPortfolio(events,fill.decidedAt,ledger.corporateActions);
 if(projection.cash===null||parseFixed(projection.cash)<0n)throw new Error('PAPER_INSUFFICIENT_CASH');
 return seal(ledger.runId,events,ledger.corporateActions);
}
export function readPaperLedger(ledger:PaperLedger,asOf:string,calendar:readonly LossCalendarDay[]|null){
 verify(ledger);return {runId:ledger.runId,revision:ledger.revision,source:'PAPER' as const,portfolio:projectPortfolio(ledger.events,asOf,ledger.corporateActions),cooldown:lossStreak({events:ledger.events,corporateActions:ledger.corporateActions??[],calendar,asOf,source:'PAPER'}),executable:false as const,performanceVerified:false as const};
}
export function appendPaperShareAdjustment(ledger:PaperLedger,action:ShareAdjustment,expectedRevision:string):PaperLedger {
 verify(ledger);const actions=ledger.corporateActions??[],prior=actions.find(row=>row.id===action.id);
 if(prior){if(configurationHash(prior)!==configurationHash(action))throw new Error('PAPER_ACTION_RETRY_CONFLICT');return structuredClone(ledger)}
 if(ledger.revision!==expectedRevision)throw new Error('PAPER_LEDGER_REVISION_CONFLICT');
 if(ledger.events.some(event=>event.kind==='FILL'&&utcInstant(event.occurredAt)>=utcInstant(action.occurredAt))||actions.some(row=>utcInstant(row.recordedAt)>utcInstant(action.recordedAt))||utcInstant(ledger.events.at(-1)!.recordedAt)>utcInstant(action.recordedAt))throw new Error('PAPER_ACTION_MUST_PRECEDE_SESSION_FILLS');
 const next=[...actions,structuredClone(action)];projectPortfolio(ledger.events,action.recordedAt,next);
 return seal(ledger.runId,ledger.events,next);
}
/** Rebuild exposure and cooldown from the PAPER ledger; supplied marks cannot alter share counts or cash. */
export function attemptPaperEntry(ledger:PaperLedger,input:HistoricalEntryInput,calendar:readonly LossCalendarDay[]|null){
 const state=readPaperLedger(ledger,input.now,calendar),marks=input.portfolio.positions;
 const holdings=Object.entries(state.portfolio.holdings).sort(([a],[b])=>a.localeCompare(b)).map(([isin,quantity])=>{
  const matches=marks.filter(mark=>mark.isin===isin);if(matches.length>1)throw new Error('DUPLICATE_PAPER_MARK');
  const mark=matches[0];return {isin,quantity,sector:mark?.sector??null,price:mark?.price??null,quoteAt:mark?.quoteAt??null,verified:mark?.verified??false,stop:mark?.stop??null};
 });
 const portfolio=valuePortfolio({cash:state.portfolio.cash,cashVerified:state.portfolio.state==='KNOWN',reconciled:true,holdings,asOf:input.now});
 const decision=simulateOpeningEntry({...input,portfolio,lossStreakPass:state.cooldown.pass});
 if(decision.state!=='SIMULATED_FILL')return {ledger:structuredClone(ledger),decision};
 return {ledger:appendPaperFill(ledger,{id:decision.id,expectedLedgerRevision:ledger.revision,isin:input.isin,side:'BUY',quantity:decision.quantity,price:decision.price!,fees:decision.fees!,modeledAt:input.now,decidedAt:input.now,sourceDecisionId:decision.id,simulated:true,executable:false}),decision};
}
