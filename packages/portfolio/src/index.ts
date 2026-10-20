import {parseFixed,formatFixed,integerShares,utcInstant} from '@vcp/domain';
export * from './ledger.js';
export * from './reconciliation.js';
export * from './protective-stop.js';
const money=(s:string)=>parseFixed(s);
const positive=(s:string)=>{const n=money(s);if(n<=0n)throw new Error('INVALID_POSITIVE_AMOUNT');return n};
const maxZero=(n:bigint)=>n>0n?n:0n;
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
 const existing=money(p.companyExposure[input.isin]??'0');
 if(p.positionCount>=5&&existing===0n)reasons.push('POSITION_CAP');
 if(p.state!=='KNOWN'||p.equity===null||p.cash===null||p.grossExposure===null||p.plannedOpenRisk===null||risk<=0n)return {state:'BUY_BLOCKED' as const,reasons:[...new Set(reasons)],quantity:0,caps:null,riskBudget:null,asOf:p.asOf};
 const equity=money(p.equity),cash=money(p.cash);if(equity<=0n)reasons.push('EQUITY_NOT_POSITIVE');
 const multiplier=input.regime==='GREEN'?2n:input.regime==='YELLOW'?1n:0n;
 const budget=maxZero(equity*4n*multiplier/2000n),hard=maxZero(equity*5n/1000n),riskBudget=budget<hard?budget:hard;
 const cap=(amount:bigint,denominator:bigint)=>maxZero(amount)/denominator;
 const caps={risk:cap(riskBudget,risk),cash:cap(cash-fees,entry),stock:cap(equity*15n/100n-existing,entry),
  sector:cap(equity*30n/100n-money(p.sectorExposure[input.sector??'']??'0'),entry),
  gross:cap(equity*(input.regime==='GREEN'?75n:input.regime==='YELLOW'?35n:0n)/100n-money(p.grossExposure),entry),
  openRisk:cap(equity*2n/100n-money(p.plannedOpenRisk),risk)};
 let quantity=Object.values(caps).reduce((a,b)=>a<b?a:b);quantity=quantity/BigInt(input.lotSize)*BigInt(input.lotSize);
 if(quantity>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('QUANTITY_OVERFLOW');
 if(quantity===0n)for(const [name,value] of Object.entries(caps))if(value<BigInt(input.lotSize))reasons.push(name.toUpperCase()+'_CAP');
 return {state:reasons.length?'BUY_BLOCKED' as const:'BUY_ELIGIBLE' as const,reasons:[...new Set(reasons)],quantity:reasons.length?0:Number(quantity),caps:Object.fromEntries(Object.entries(caps).map(([k,v])=>[k,v.toString()])),riskBudget:formatFixed(riskBudget),asOf:p.asOf};
}
