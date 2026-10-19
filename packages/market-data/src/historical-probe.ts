import {createHash} from 'node:crypto';
import {utcInstant} from '@vcp/domain';
import {normalizeHistoricalResponse,type HistoricalResponseInput} from './historical-response.js';
export interface HistoricalProbeInput {
 asOf:string;
 auth:{authenticated:boolean;staticIpVerified:boolean;verifiedAt:string;expiresAt:string}|null;
 quota:{verified:boolean;knownAt:string;second:number;minute:number;hour:number}|null;
 wide:HistoricalResponseInput;narrow:HistoricalResponseInput[];
}
/** A probe compares observed bars; requested days alone never establish coverage. */
export function historicalProbe(input:HistoricalProbeInput){
 const at=utcInstant(input.asOf).valueOf(),reasons:string[]=[],unknown:string[]=[];
 const auth=input.auth;
 if(!auth||!auth.authenticated||!auth.staticIpVerified||utcInstant(auth.verifiedAt).valueOf()>at||utcInstant(auth.expiresAt).valueOf()<=at)unknown.push('BROKER_AUTH_IP_UNVERIFIED');
 const quota=input.quota;
 const quotaVerified=!!quota&&quota.verified&&utcInstant(quota.knownAt).valueOf()<=at&&[quota.second,quota.minute,quota.hour].every(n=>Number.isSafeInteger(n)&&n>0);
 if(!quotaVerified)unknown.push('ACCOUNT_QUOTA_UNVERIFIED');
 const effectiveQuota=quotaVerified?{second:Math.min(1,quota!.second),minute:Math.min(60,quota!.minute),hour:Math.min(3000,quota!.hour)}:null;
 const wide=normalizeHistoricalResponse(input.wide),narrow=input.narrow.map(normalizeHistoricalResponse);
 for(const result of [wide,...narrow]){
  if(utcInstant(result.receivedAt).valueOf()>at)unknown.push('RESPONSE_NOT_YET_KNOWN');
  if(result.status==='UNKNOWN')unknown.push(...result.reasons);
  else if(result.status!=='COMPLETE')reasons.push(...result.reasons);
 }
 const combined=new Map<string,string>();let overlap=false;
 for(const result of narrow){
  if(result.listingId!==wide.listingId||result.request.exchange!==wide.request.exchange||result.request.symbolToken!==wide.request.symbolToken||result.mappingSnapshotId!==wide.mappingSnapshotId||result.request.from<wide.request.from||result.request.to>wide.request.to||(result.request.from===wide.request.from&&result.request.to===wide.request.to)){reasons.push('PROBE_SCOPE_MISMATCH');continue}
  for(const bar of result.observed){const prior=combined.get(bar.session);if(prior){overlap=true;if(prior!==bar.hash)reasons.push('OVERLAP_VALUE_MISMATCH')}combined.set(bar.session,bar.hash)}
 }
 if(narrow.length<2||!overlap)unknown.push('OVERLAPPING_PROBES_REQUIRED');
 const expected=[...wide.observed.map(bar=>bar.session),...wide.missing.map(bar=>bar.session)];
 if(expected.some(session=>!combined.has(session)))reasons.push('NARROW_COVERAGE_INCOMPLETE');
 if(wide.observed.some(bar=>combined.has(bar.session)&&combined.get(bar.session)!==bar.hash))reasons.push('WIDE_NARROW_VALUE_MISMATCH');
 const summarize=(result:ReturnType<typeof normalizeHistoricalResponse>)=>{const {bars:_,quarantined:__,...summary}=result;return {...summary,quarantined:result.quarantined.map(row=>({session:row.bar.session,reasons:row.reasons}))}};
 const evidence={version:1,asOf:input.asOf,status:unknown.length?'UNKNOWN':reasons.length?'FAILED':'PASSED',reasons:[...new Set([...unknown,...reasons])].sort(),auth:auth?{...auth}:null,observedQuota:quota?{...quota}:null,effectiveQuota,wide:summarize(wide),narrow:narrow.map(summarize)};
 return {...evidence,revision:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')};
}
