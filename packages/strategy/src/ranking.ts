import {parseFixed,utcInstant} from '@vcp/domain';
import type {Pattern} from '@vcp/vcp';
export const MARKET_STATE_ORDER=['BUY_MARKET_SIGNAL','READY','WATCH','DEVELOPING','BLOCKED_DATA','REJECTED'] as const;
export type MarketState=typeof MARKET_STATE_ORDER[number];
export interface RankInput {
 instrumentId:string; marketState:MarketState; rsPercentile:string|null; legs:number;
 finalDepth:string|null; vdu:string|null; pivot:string|null; close:string|null; adv20Median:string|null;
 reasons:readonly string[];
 patternEvidence?:{primaryPatternId:string|null;nestedPatternIds:string[];patterns:Pattern[]};
}
export interface ScanEvidence {scanId:string;asOf:string;dataRevision:string;configHash:string}
const decimal=(value:string)=>parseFixed(value,8,24);
const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0;
function nullable(a:bigint|null,b:bigint|null,descending=false){
 if(a===null)return b===null?0:1;if(b===null)return -1;
 const order=a<b?-1:a>b?1:0;return descending?-order:order;
}
function proximity(row:RankInput):readonly [bigint,bigint]|null {
 if(row.pivot===null||row.close===null)return null;
 const pivot=decimal(row.pivot),close=decimal(row.close);
 if(pivot<=0n)throw new Error('INVALID_RANK_PIVOT');
 return [pivot>close?pivot-close:0n,pivot];
}
function compareProximity(a:RankInput,b:RankInput){
 const x=proximity(a),y=proximity(b);if(!x)return y?1:0;if(!y)return -1;
 return nullable(x[0]*y[1],y[0]*x[1]);
}
function validate(row:RankInput){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.instrumentId))throw new Error('INVALID_INSTRUMENT_UUID');
 if(!MARKET_STATE_ORDER.includes(row.marketState))throw new Error('UNKNOWN_MARKET_STATE');
 if(!Number.isSafeInteger(row.legs)||row.legs<0||row.legs>6)throw new Error('INVALID_LEG_COUNT');
 for(const value of [row.rsPercentile,row.finalDepth,row.vdu,row.pivot,row.close,row.adv20Median])if(value!==null&&decimal(value)<0n)throw new Error('INVALID_RANK_VALUE');
 if(row.rsPercentile!==null&&decimal(row.rsPercentile)>decimal('100'))throw new Error('INVALID_RS_PERCENTILE');
 if(row.finalDepth!==null&&decimal(row.finalDepth)>decimal('100'))throw new Error('INVALID_FINAL_DEPTH');
 proximity(row);
}
const optional=(value:string|null)=>value===null?null:decimal(value);
/** Never round proximity before comparison; equal displayed values can have different ranks. */
export function compareCandidates(a:RankInput,b:RankInput){
 return MARKET_STATE_ORDER.indexOf(a.marketState)-MARKET_STATE_ORDER.indexOf(b.marketState)
  ||nullable(optional(a.rsPercentile),optional(b.rsPercentile),true)
  ||b.legs-a.legs
  ||nullable(optional(a.finalDepth),optional(b.finalDepth))
  ||nullable(optional(a.vdu),optional(b.vdu))
  ||compareProximity(a,b)
  ||nullable(optional(a.adv20Median),optional(b.adv20Median),true)
  ||lexical(a.instrumentId,b.instrumentId);
}
export function rankCandidates(inputs:readonly RankInput[],evidence:ScanEvidence){
 utcInstant(evidence.asOf);
 if(!evidence.scanId||!evidence.dataRevision||!/^[0-9a-f]{64}$/.test(evidence.configHash))throw new Error('INVALID_SCAN_EVIDENCE');
 const seen=new Set<string>();for(const row of inputs){validate(row);if(seen.has(row.instrumentId))throw new Error('DUPLICATE_CANONICAL_LISTING');seen.add(row.instrumentId)}
 return [...inputs].sort(compareCandidates).map((row,index)=>{
  const distance=proximity(row);
  return {...row,reasons:[...row.reasons],patternEvidence:row.patternEvidence??null,missingData:row.reasons.filter(reason=>/UNKNOWN|MISSING|INCOMPLETE|UNAVAILABLE/.test(reason)),...evidence,rank:index+1,
   rankTuple:[row.marketState,row.rsPercentile,row.legs,row.finalDepth,row.vdu,
    distance?{numerator:distance[0].toString(),denominator:distance[1].toString()}:null,row.adv20Median,row.instrumentId] as const};
 });
}
