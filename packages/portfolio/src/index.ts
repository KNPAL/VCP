import {parseFixed,formatFixed,integerShares,utcInstant} from '@vcp/domain';
import {remainingWeightedEntry} from './actual-risk.js';
import type {Lot} from './ledger.js';
export * from './ledger.js';
export * from './reconciliation.js';
export * from './protective-stop.js';
export * from './loss-streak.js';
export * from './trailing-stop.js';
export * from './breakout-failure.js';
export * from './partial-profit.js';
export * from './exit-precedence.js';
export * from './actual-risk.js';
export * from './position-status.js';
const money=(s:string)=>parseFixed(s);
const positive=(s:string)=>{const n=money(s);if(n<=0n)throw new Error('INVALID_POSITIVE_AMOUNT');return n};
const maxZero=(n:bigint)=>n>0n?n:0n;
/** Translate independently calculated limits into evidence gates without hiding unknown caps. */
export function entrySizingGates(sizing:ReturnType<typeof sizeEntry>|null,lotSize:number,lossStreakPass:boolean|null){
 if(!Number.isSafeInteger(lotSize)||lotSize<=0)throw new Error('INVALID_LOT_SIZE');
 type Gate='PASS'|'FAIL'|'UNKNOWN';
 const cap=(name:string):Gate=>{const value=sizing?.caps[name];return value===null||value===undefined?'UNKNOWN':BigInt(value)>=BigInt(lotSize)?'PASS':'FAIL'};
 const reasons=sizing?.reasons??[];
 return {POSITION_CAP:(!sizing?'UNKNOWN':reasons.includes('POSITION_CAP')?'FAIL':'PASS') as Gate,
  CASH:cap('cash'),STOCK_CAP:cap('stock'),SECTOR_CAP:cap('sector'),OPEN_RISK_CAP:cap('openRisk'),
  GROSS_CAP:(reasons.includes('REGIME_UNKNOWN')?'UNKNOWN':cap('gross')) as Gate,
  PER_TRADE_RISK:(reasons.some(r=>r==='STOP_NOT_BELOW_ENTRY'||r==='STOP_WIDER_THAN_8_PERCENT')?'FAIL':reasons.includes('REGIME_UNKNOWN')?'UNKNOWN':cap('risk')) as Gate,
  LOSS_STREAK:(lossStreakPass===null?'UNKNOWN':lossStreakPass?'PASS':'FAIL') as Gate};
}
export interface HoldingMark {isin:string;sector:string|null;quantity:number;price:string|null;quoteAt:string|null;verified:boolean;stop:string|null}
export function valuePortfolio(input:{cash:string|null;cashVerified:boolean;reconciled:boolean;holdings:readonly HoldingMark[];asOf:string}){
 const now=utcInstant(input.asOf).valueOf(),reasons:string[]=[];
 if(input.cash===null||!input.cashVerified)reasons.push('CASH_UNKNOWN');
 if(!input.reconciled)reasons.push('PORTFOLIO_UNRECONCILED');
 const cash=input.cash===null||!input.cashVerified?null:money(input.cash),companies:Record<string,bigint>=Object.create(null),sectors:Record<string,bigint>=Object.create(null);
 const unknownCompanies=new Set<string>(),unknownSectors=new Set<string>();
 let gross=0n,plannedRisk=0n;
 const openCompanies=new Set<string>(),companySectors=new Map<string,string>();
 const positions=input.holdings.map(holding=>{
  const qty=integerShares(holding.quantity);if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(holding.isin))throw new Error('INVALID_ISIN');
  if(qty===0)return {...holding,markAgeMs:null,value:'0.000000',plannedDownside:'0.000000'};
  openCompanies.add(holding.isin);
  const age=holding.quoteAt===null?null:now-utcInstant(holding.quoteAt).valueOf();
  const current=holding.verified&&age!==null&&age>=0&&age<60000&&holding.price!==null;
  if(!current){reasons.push('MARK_UNVERIFIED:'+holding.isin);unknownCompanies.add(holding.isin);if(holding.sector)unknownSectors.add(holding.sector)}
  if(!holding.sector)reasons.push('SECTOR_UNKNOWN:'+holding.isin);
  else {const prior=companySectors.get(holding.isin);if(prior&&prior!==holding.sector)reasons.push('SECTOR_CONFLICT:'+holding.isin);companySectors.set(holding.isin,holding.sector)}
  if(holding.stop===null)reasons.push('STOP_UNKNOWN:'+holding.isin);
  const mark=!current?null:positive(holding.price!),stop=holding.stop===null?null:positive(holding.stop);
  const value=mark===null?null:mark*BigInt(qty),downside=mark===null||stop===null?null:maxZero(mark-stop)*BigInt(qty);
  if(value!==null){gross+=value;companies[holding.isin]=(companies[holding.isin]??0n)+value;if(holding.sector)sectors[holding.sector]=(sectors[holding.sector]??0n)+value}
  if(downside!==null)plannedRisk+=downside;
  return {...holding,markAgeMs:age,value:value===null?null:formatFixed(value),plannedDownside:downside===null?null:formatFixed(downside)};
 });
 const missingPrices=positions.some(x=>x.quantity>0&&x.value===null),missingStops=positions.some(x=>x.quantity>0&&x.plannedDownside===null);
 return {state:reasons.length?'UNKNOWN' as const:'KNOWN' as const,reasons:[...new Set(reasons)],asOf:input.asOf,cash:cash===null?null:formatFixed(cash),equity:cash===null||missingPrices?null:formatFixed(cash+gross),grossExposure:missingPrices?null:formatFixed(gross),plannedOpenRisk:missingStops?null:formatFixed(plannedRisk),
  positionCount:openCompanies.size,companyExposure:Object.fromEntries([...new Set([...Object.keys(companies),...unknownCompanies])].sort().map(k=>[k,unknownCompanies.has(k)?null:formatFixed(companies[k]!)])),sectorExposure:Object.fromEntries([...new Set([...Object.keys(sectors),...unknownSectors])].sort().map(k=>[k,unknownSectors.has(k)?null:formatFixed(sectors[k]!)])),positions,reconciled:input.reconciled};
}
export type PortfolioValue=ReturnType<typeof valuePortfolio>;
export function sizeEntry(input:{portfolio:PortfolioValue;isin:string;sector:string|null;entry:string;stop:string;regime:'GREEN'|'YELLOW'|'RED'|'UNKNOWN';lotSize:number;estimatedFees:string;lossStreakPass:boolean|null}){
 const {portfolio:p}=input,reasons=[...p.reasons];
 const entry=positive(input.entry),stop=positive(input.stop),fees=money(input.estimatedFees);
 if(fees<0n)throw new Error('INVALID_FEES');
 if(!Number.isSafeInteger(input.lotSize)||input.lotSize<=0)throw new Error('INVALID_LOT_SIZE');
 if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(input.isin))throw new Error('INVALID_ISIN');
 if(input.lossStreakPass!==true)reasons.push(input.lossStreakPass===null?'LOSS_STREAK_UNKNOWN':'LOSS_STREAK_BREAKER');
 if(!input.sector)reasons.push('SECTOR_UNKNOWN');
 if(input.regime==='RED'||input.regime==='UNKNOWN')reasons.push('REGIME_'+input.regime);
 const risk=entry-stop;if(risk<=0n)reasons.push('STOP_NOT_BELOW_ENTRY');else if(risk*100n>entry*8n)reasons.push('STOP_WIDER_THAN_8_PERCENT');
 const existing=p.companyExposure[input.isin]===null?null:money(p.companyExposure[input.isin]??'0');
 if(p.positionCount>=5&&!p.positions.some(position=>position.isin===input.isin&&position.quantity>0))reasons.push('POSITION_CAP');
 if(p.state!=='KNOWN')reasons.push('PORTFOLIO_UNKNOWN');
 const equity=p.equity===null?null:money(p.equity)-fees,cash=p.cash===null?null:money(p.cash);if(equity!==null&&equity<=0n)reasons.push('EQUITY_NOT_POSITIVE');
 const multiplier=input.regime==='GREEN'?2n:input.regime==='YELLOW'?1n:0n;
 const budget=equity===null?null:maxZero(equity*4n*multiplier/2000n),hard=equity===null?null:maxZero(equity*5n/1000n),riskBudget=budget===null||hard===null?null:budget<hard?budget:hard;
 const cap=(amount:bigint,denominator:bigint)=>maxZero(amount)/denominator;
 const sectorKnown=!!input.sector&&!p.reasons.some(reason=>reason.startsWith('SECTOR_UNKNOWN')||reason.startsWith('SECTOR_CONFLICT'))&&p.sectorExposure[input.sector]!==null;
 const caps={risk:riskBudget===null||risk<=0n?null:cap(riskBudget,risk),cash:cash===null?null:cap(cash-fees,entry),stock:equity===null||existing===null?null:cap(equity*15n/100n-existing,entry),
  sector:equity===null||!sectorKnown?null:cap(equity*30n/100n-money(p.sectorExposure[input.sector!]??'0'),entry),
  gross:equity===null||p.grossExposure===null?null:cap(equity*(input.regime==='GREEN'?75n:input.regime==='YELLOW'?35n:0n)/100n-money(p.grossExposure),entry),
  openRisk:equity===null||p.plannedOpenRisk===null||risk<=0n?null:cap(equity*2n/100n-money(p.plannedOpenRisk),risk)};
 for(const [name,value] of Object.entries(caps))if(value===null)reasons.push((name==='openRisk'?'OPEN_RISK':name.toUpperCase())+'_CAP_UNKNOWN');
 const values=Object.values(caps),known=values.filter((v):v is bigint=>v!==null);
 let quantity=known.length!==values.length?0n:known.reduce((a,b)=>a<b?a:b);quantity=quantity/BigInt(input.lotSize)*BigInt(input.lotSize);
 if(quantity>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('QUANTITY_OVERFLOW');
 if(quantity===0n)for(const [name,value] of Object.entries(caps))if(value!==null&&value<BigInt(input.lotSize))reasons.push((name==='openRisk'?'OPEN_RISK':name.toUpperCase())+'_CAP');
 return {state:reasons.length?'BUY_BLOCKED' as const:'BUY_ELIGIBLE' as const,reasons:[...new Set(reasons)],quantity:reasons.length?0:Number(quantity),caps:Object.fromEntries(Object.entries(caps).map(([k,v])=>[k,v===null?null:v.toString()])),riskBudget:riskBudget===null?null:formatFixed(riskBudget),asOf:p.asOf};
}
/** Explicit manual proposal only; never an automated ADD event. */
export function sizeTopUp(input:Parameters<typeof sizeEntry>[0]&{lots:readonly Lot[];requestedQuantity:number}){
 if(!Number.isSafeInteger(input.requestedQuantity)||input.requestedQuantity<=0)throw new Error('INVALID_TOPUP_QUANTITY');
 const base=sizeEntry(input),remaining=remainingWeightedEntry(input.lots,input.isin),reasons=base.reasons.filter(r=>r!=='STOP_WIDER_THAN_8_PERCENT');
 const openQuantity=input.portfolio.positions.filter(p=>p.isin===input.isin).reduce((n,p)=>n+p.quantity,0);
 if(!remaining||remaining.quantity!==openQuantity)reasons.push('OPEN_FIFO_POSITION_REQUIRED');
 if(input.requestedQuantity%input.lotSize!==0)reasons.push('MARKET_LOT');
 for(const [name,limit] of Object.entries(base.caps))if(limit===null||BigInt(input.requestedQuantity)>BigInt(limit))reasons.push('TOPUP_'+name.toUpperCase()+'_CAP');
 const qty=BigInt(input.requestedQuantity),oldQty=BigInt(remaining?.quantity??0),priceCost=input.lots.filter(l=>l.isin===input.isin&&l.remainingQty>0).reduce((n,l)=>n+money(l.price)*BigInt(l.remainingQty),0n)+money(input.entry)*qty;
 const total=oldQty+qty,weighted=priceCost/total,stop=money(input.stop);
 if(weighted<=stop)reasons.push('STOP_NOT_BELOW_WEIGHTED_ENTRY');
 else if((priceCost-stop*total)*100n>priceCost*8n)reasons.push('STOP_WIDER_THAN_8_PERCENT');
 const fees=input.lots.filter(l=>l.isin===input.isin&&l.remainingQty>0).reduce((n,l)=>n+money(l.remainingFees),0n)+money(input.estimatedFees);
 return {...base,state:reasons.length?'BUY_BLOCKED' as const:'BUY_ELIGIBLE' as const,reasons:[...new Set(reasons)],quantity:reasons.length?0:input.requestedQuantity,requestedQuantity:input.requestedQuantity,remaining,weightedEntry:formatFixed(weighted),costPerShareAfterFees:formatFixed((priceCost+fees)/total),automatedAdd:false as const};
}

