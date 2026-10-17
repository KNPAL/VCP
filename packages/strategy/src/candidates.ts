import {selectPrimary,type Pattern} from '@vcp/vcp';
import type {RankInput,MarketState} from './ranking.js';
/** One row per canonical listing; nested evidence is retained even when no pattern is READY. */
export function companyCandidate(input:{listingId:string;patterns:readonly Pattern[];close:string;rsPercentile:string|null;adv20Median:string|null;dataReasons:readonly string[];confirmedMarketEventId:string|null}):RankInput{
 const patterns=[...input.patterns].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(patterns.some(pattern=>pattern.listingId!==input.listingId)||new Set(patterns.map(p=>p.id)).size!==patterns.length)throw new Error('INVALID_COMPANY_PATTERNS');
 const primary=selectPrimary(patterns),reasons=[...input.dataReasons,...(primary?.reasons??[])];
 let state:MarketState;
 if(input.confirmedMarketEventId)state='BUY_MARKET_SIGNAL';
 else if(input.dataReasons.length||primary?.state==='WATCH_DATA')state='BLOCKED_DATA';
 else if(primary?.state==='READY')state='READY';
 else if(primary?.state==='WATCH')state='WATCH';
 else if(patterns.some(pattern=>pattern.state==='DEVELOPING'))state='DEVELOPING';
 else {state='REJECTED';reasons.push(...patterns.flatMap(pattern=>pattern.reasons));if(!patterns.length)reasons.push('NO_CONFIRMED_PATTERN')}
 if(input.rsPercentile===null)reasons.push('RS_UNKNOWN');if(input.adv20Median===null)reasons.push('ADV_UNKNOWN');
 return {instrumentId:input.listingId,marketState:state,rsPercentile:input.rsPercentile,legs:primary?.legs.length??0,finalDepth:primary?.legs.at(-1)?.depth??null,vdu:primary?.vdu??null,pivot:primary?.pivot??null,close:input.close,adv20Median:input.adv20Median,reasons:[...new Set(reasons)].sort(),
  patternEvidence:{primaryPatternId:primary?.id??null,nestedPatternIds:patterns.filter(p=>p.id!==primary?.id).map(p=>p.id),patterns}};
}
