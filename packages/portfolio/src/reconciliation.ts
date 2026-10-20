import {parseFixed,utcInstant,integerShares} from '@vcp/domain';
import {projectPortfolio,type PortfolioEvent} from './ledger.js';
export interface BrokerStatement {asOf:string;sourceReference:string;cash:string;holdings:{isin:string;quantity:number}[];fillReferences:string[];allOutsideActivityIncluded:boolean}
export function reconcileStatement(events:readonly PortfolioEvent[],statement:BrokerStatement,decidedAt:string){
 const at=utcInstant(statement.asOf),decision=utcInstant(decidedAt);
 if(at>decision||!statement.sourceReference.trim()||statement.sourceReference.length>200||typeof statement.allOutsideActivityIncluded!=='boolean'||statement.holdings.length>1000||statement.fillReferences.length>100000)throw new Error('INVALID_RECONCILIATION_STATEMENT');
 const actualCash=parseFixed(statement.cash),holdings=new Map<string,number>();
 for(const row of statement.holdings){if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(row.isin)||holdings.has(row.isin))throw new Error('INVALID_STATEMENT_HOLDING');integerShares(row.quantity);holdings.set(row.isin,row.quantity)}
 if(statement.fillReferences.some(ref=>typeof ref!=='string'||!ref.trim()||ref.length>200)||new Set(statement.fillReferences).size!==statement.fillReferences.length)throw new Error('INVALID_STATEMENT_FILL_REFERENCES');
 const portfolio=projectPortfolio(events,decidedAt),reasons:string[]=[];
 if(portfolio.state!=='KNOWN')reasons.push('INITIAL_CAPITAL_REQUIRED');
 if(!statement.allOutsideActivityIncluded)reasons.push('OUTSIDE_ACTIVITY_UNVERIFIED');
 if(events.some(e=>utcInstant(e.occurredAt)>at))reasons.push('STATEMENT_BEFORE_JOURNAL_ACTIVITY');
 if(portfolio.cash===null||parseFixed(portfolio.cash)!==actualCash)reasons.push('CASH_MISMATCH');
 const quantities=[...new Set([...Object.keys(portfolio.holdings),...holdings.keys()])].sort().map(isin=>({isin,journal:portfolio.holdings[isin]??0,statement:holdings.get(isin)??0})).filter(row=>row.journal!==row.statement);
 if(quantities.length)reasons.push('OUTSIDE_HOLDINGS_MISMATCH');
 const recorded=new Set(events.filter(e=>e.kind==='FILL'&&!portfolio.reversed.includes(e.id)).map(e=>e.kind==='FILL'?e.brokerReference:''));
 const missingInJournal=statement.fillReferences.filter(ref=>!recorded.has(ref)),missingInStatement=[...recorded].filter(ref=>!statement.fillReferences.includes(ref));
 if(missingInJournal.length||missingInStatement.length)reasons.push('FILL_REFERENCE_MISMATCH');
 return {state:reasons.length?'PORTFOLIO_UNRECONCILED' as const:'RECONCILED_AS_OF' as const,reasons,asOf:statement.asOf,decidedAt,quantities,missingInJournal,missingInStatement,executable:false as const};
}
