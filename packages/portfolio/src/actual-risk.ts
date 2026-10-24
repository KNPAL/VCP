import {parseFixed,formatFixed} from '@vcp/domain';
import type {PortfolioValue} from './index.js';
import type {Lot} from './ledger.js';
/** Remaining FIFO lots only; sold lots and their allocated fees are excluded. */
export function remainingWeightedEntry(lots:readonly Lot[],isin:string){
 const open=lots.filter(l=>l.isin===isin&&l.remainingQty>0),quantity=open.reduce((n,l)=>n+BigInt(l.remainingQty),0n);
 if(quantity===0n)return null;
 const priceCost=open.reduce((n,l)=>n+(l.remainingPriceCost===undefined?parseFixed(l.price)*BigInt(l.remainingQty):parseFixed(l.remainingPriceCost)),0n),fees=open.reduce((n,l)=>n+parseFixed(l.remainingFees),0n);
 return {quantity:Number(quantity),weightedEntry:formatFixed(priceCost/quantity),costPerShareAfterFees:formatFixed((priceCost+fees)/quantity),remainingCost:formatFixed(priceCost+fees)};
}
/** Actual breaches annotate recorded facts. They never reject or undo a fill. */
export function actualRisk(portfolio:PortfolioValue,regime:'GREEN'|'YELLOW'|'RED'|'UNKNOWN'){
 const breaches:string[]=[],unknown:string[]=[];
 const equity=portfolio.equity===null?null:parseFixed(portfolio.equity);
 const check=(name:string,value:string|null|undefined,numerator:bigint,denominator=100n)=>{
  if(value===null||value===undefined||equity===null||equity<=0n){unknown.push(name);return}
  if(parseFixed(value)*denominator>equity*numerator)breaches.push(name);
 };
 if(portfolio.cash===null)unknown.push('CASH');else if(parseFixed(portfolio.cash)<0n)breaches.push('CASH');
 if(portfolio.positionCount>5)breaches.push('POSITION_CAP');
 for(const [isin,value] of Object.entries(portfolio.companyExposure))check('STOCK_CAP:'+isin,value,15n);
 for(const [sector,value] of Object.entries(portfolio.sectorExposure))check('SECTOR_CAP:'+sector,value,30n);
 if(portfolio.reasons.some(r=>r.startsWith('SECTOR_UNKNOWN')||r.startsWith('SECTOR_CONFLICT')))unknown.push('SECTOR_CAP');
 if(regime==='UNKNOWN')unknown.push('GROSS_CAP');else check('GROSS_CAP',portfolio.grossExposure,regime==='GREEN'?75n:regime==='YELLOW'?35n:0n);
 check('OPEN_RISK_CAP',portfolio.plannedOpenRisk,2n);
 for(const p of portfolio.positions)if(p.quantity>0){if(p.stop===null||p.price===null||!p.verified)unknown.push('STOP:'+p.isin);else if(parseFixed(p.price)<=parseFixed(p.stop))breaches.push('STOP_BREACHED:'+p.isin)}
 return {state:breaches.length?'BREACH_ACTUAL' as const:unknown.length?'UNABLE_TO_EVALUATE' as const:'WITHIN_OBSERVED_CAPS' as const,breaches,unknown,asOf:portfolio.asOf,regime,executable:false as const};
}
