import {parseFixed,formatFixed,integerShares,utcInstant} from '@vcp/domain';
export type FundingKind='INITIAL_CAPITAL'|'DEPOSIT'|'WITHDRAWAL'|'FEE'|'DIVIDEND'|'CORPORATE_CREDIT'|'CORPORATE_DEBIT';
interface BaseEvent {id:string;sequence:number;occurredAt:string;recordedAt:string;sourceId:string;author:string}
export type PortfolioEvent=BaseEvent&(
 {kind:FundingKind;amount:string;verified:boolean}|
 {kind:'FILL';isin:string;side:'BUY'|'SELL';quantity:number;price:string;fees:string;brokerReference:string;replacementOf?:string}|
 {kind:'REVERSAL';targetId:string;reason:string}
);
export interface Lot {fillId:string;isin:string;originalQty:number;remainingQty:number;price:string;remainingFees:string;occurredAt:string}
const fundingKinds=['INITIAL_CAPITAL','DEPOSIT','WITHDRAWAL','FEE','DIVIDEND','CORPORATE_CREDIT','CORPORATE_DEBIT'];
const instant=(s:string)=>utcInstant(s).valueOf();
export function validatePortfolioEvent(event:PortfolioEvent){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(event.id)||!Number.isSafeInteger(event.sequence)||event.sequence<1||!event.sourceId.trim()||!event.author.trim())throw new Error('INVALID_EVENT_IDENTITY');
 if(instant(event.occurredAt)>instant(event.recordedAt))throw new Error('FUTURE_FINANCIAL_EVENT');
 if(event.kind==='FILL'){
  if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(event.isin)||!['BUY','SELL'].includes(event.side)||integerShares(event.quantity)===0||parseFixed(event.price)<=0n||parseFixed(event.fees)<0n||!event.brokerReference.trim())throw new Error('INVALID_FILL');
 }else if(event.kind==='REVERSAL'){if(!event.targetId||!event.reason.trim())throw new Error('INVALID_REVERSAL')}
 else if(!fundingKinds.includes(event.kind)||parseFixed(event.amount)<=0n||event.verified!==true)throw new Error('UNVERIFIED_CASH_FLOW');
}
function signedCash(event:PortfolioEvent){
 if(event.kind==='REVERSAL')throw new Error('REVERSAL_REQUIRES_TARGET');
 if(event.kind==='FILL'){const value=parseFixed(event.price)*BigInt(event.quantity),fees=parseFixed(event.fees);return event.side==='BUY'?-value-fees:value-fees}
 const amount=parseFixed(event.amount);return ['WITHDRAWAL','FEE','CORPORATE_DEBIT'].includes(event.kind)?-amount:amount;
}
/** Replay only facts known at the requested cutoff; alerts cannot enter this ledger. */
export function projectPortfolio(events:readonly PortfolioEvent[],asOf:string){
 const cutoff=instant(asOf),ids=new Set<string>(),sequences=new Set<number>();
 for(const event of events){validatePortfolioEvent(event);if(ids.has(event.id)||sequences.has(event.sequence))throw new Error('DUPLICATE_LEDGER_EVENT');ids.add(event.id);sequences.add(event.sequence)}
 const visible=events.filter(e=>instant(e.recordedAt)<=cutoff&&instant(e.occurredAt)<=cutoff).sort((a,b)=>a.sequence-b.sequence),byId=new Map(visible.map(e=>[e.id,e]));
 const reversed=new Set<string>();const cashEntries:{eventId:string;amount:string;sourceId:string}[]=[];let cash=0n;
 const initial=visible.filter(e=>e.kind==='INITIAL_CAPITAL');if(initial.length>1)throw new Error('INITIAL_CAPITAL_ALREADY_SET');
 if(visible.length&&!initial.length)throw new Error('INITIAL_CAPITAL_REQUIRED');
 if(initial[0]&&visible[0]!.id!==initial[0].id)throw new Error('INITIAL_CAPITAL_MUST_BE_FIRST');
 const refs=new Map<string,string>(),replaced=new Set<string>();
 for(const event of visible){
  let delta:bigint;
  if(event.kind==='REVERSAL'){
   const target=byId.get(event.targetId);if(!target||target.kind!=='FILL'||target.sequence>=event.sequence||reversed.has(target.id))throw new Error('INVALID_REVERSAL_TARGET');
   reversed.add(target.id);delta=-signedCash(target);
  }else {
   if(event.kind==='FILL'){
    if(event.replacementOf&&(!reversed.has(event.replacementOf)||replaced.has(event.replacementOf)))throw new Error('REPLACEMENT_REQUIRES_REVERSAL');
    const key=event.brokerReference;if(refs.has(key)&&refs.get(key)!==event.replacementOf)throw new Error('DUPLICATE_BROKER_FILL');refs.set(key,event.id);
    if(event.replacementOf)replaced.add(event.replacementOf);
   }
   delta=signedCash(event);
  }
  cash+=delta;cashEntries.push({eventId:event.id,amount:formatFixed(delta),sourceId:event.sourceId});
 }
 const lots:Lot[]=[],realized:{fillId:string;isin:string;quantity:number;pnl:string;consumed:{lotId:string;quantity:number;buyFees:string}[]}[]=[];
 const originalSequence=(event:PortfolioEvent):number=>{
  if(event.kind==='FILL'&&event.replacementOf){const original=byId.get(event.replacementOf);if(!original||original.sequence>=event.sequence)throw new Error('INVALID_REPLACEMENT_TARGET');return originalSequence(original)}
  return event.sequence;
 };
 const fills=visible.filter(e=>e.kind==='FILL'&&!reversed.has(e.id)).sort((a,b)=>instant(a.occurredAt)-instant(b.occurredAt)||originalSequence(a)-originalSequence(b));
 for(const event of fills){if(event.kind!=='FILL')continue;
  if(event.side==='BUY'){lots.push({fillId:event.id,isin:event.isin,originalQty:event.quantity,remainingQty:event.quantity,price:event.price,remainingFees:event.fees,occurredAt:event.occurredAt});continue}
  let remaining=event.quantity,cost=0n;const consumed:{lotId:string;quantity:number;buyFees:string}[]=[];
  for(const lot of lots){if(!remaining)break;if(lot.isin!==event.isin||!lot.remainingQty)continue;
   const qty=Math.min(remaining,lot.remainingQty),fees=parseFixed(lot.remainingFees)*BigInt(qty)/BigInt(lot.remainingQty);
   cost+=parseFixed(lot.price)*BigInt(qty)+fees;lot.remainingFees=formatFixed(parseFixed(lot.remainingFees)-fees);lot.remainingQty-=qty;remaining-=qty;consumed.push({lotId:lot.fillId,quantity:qty,buyFees:formatFixed(fees)});
  }
  if(remaining)throw new Error('SELL_EXCEEDS_HOLDINGS');
  realized.push({fillId:event.id,isin:event.isin,quantity:event.quantity,pnl:formatFixed(parseFixed(event.price)*BigInt(event.quantity)-parseFixed(event.fees)-cost),consumed});
 }
 const holdings:Record<string,number>={};for(const lot of lots)if(lot.remainingQty)holdings[lot.isin]=(holdings[lot.isin]??0)+lot.remainingQty;
 for(const qty of Object.values(holdings))integerShares(qty);
 const positions=Object.entries(holdings).sort().map(([isin,quantity])=>({isin,quantity,
  costBasis:formatFixed(lots.filter(lot=>lot.isin===isin).reduce((total,lot)=>total+parseFixed(lot.price)*BigInt(lot.remainingQty)+parseFixed(lot.remainingFees),0n)),
  realizedPnl:formatFixed(realized.filter(row=>row.isin===isin).reduce((total,row)=>total+parseFixed(row.pnl),0n))}));
 return {asOf,cash:initial.length?formatFixed(cash):null,state:initial.length?'KNOWN' as const:'UNKNOWN' as const,reasons:initial.length?[]:['INITIAL_CAPITAL_REQUIRED'],holdings,positions,lots,realized,realizedPnl:formatFixed(realized.reduce((total,row)=>total+parseFixed(row.pnl),0n)),cashEntries,reversed:[...reversed]};
}
