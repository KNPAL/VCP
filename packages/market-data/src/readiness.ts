import {utcInstant,parseFixed,sessionDate,exchangeDate} from '@vcp/domain';
export const GATES={
 G01:{dependency:'SmartAPI authentication and registered static IP',failure:'BROKER_UNAVAILABLE',blocks:['DOWNLOAD','BUY','MONITOR']},
 G02:{dependency:'Historical coverage',failure:'DATA_INCOMPLETE',blocks:['DERIVE','BUY']},
 G03:{dependency:'Verified corporate-action adjustments',failure:'BLOCKED_DATA',blocks:['DERIVE','BUY','MONITOR']},
 G04:{dependency:'NIFTY 500 price-index benchmark',failure:'BLOCKED_DATA',blocks:['BUY']},
 G05:{dependency:'Effective company sectors',failure:'BLOCKED_DATA',blocks:['BUY']},
 G06:{dependency:'Current surveillance and tradability',failure:'BLOCKED_DATA',blocks:['BUY']},
 G07:{dependency:'Data licensing and permitted uses',failure:'BLOCKED_DATA',blocks:['DOWNLOAD','STORE','DERIVE','DISPLAY','BUY','MONITOR']},
 G08:{dependency:'Complete reconciled portfolio balance',failure:'PORTFOLIO_UNRECONCILED',blocks:['BUY']},
 G09:{dependency:'Live quote and heartbeat integrity',failure:'MONITOR_DEGRADED',blocks:['BUY','MONITOR']},
 G10:{dependency:'Official session and final auction candle',failure:'BLOCKED_DATA',blocks:['DERIVE','BUY']},
} as const;
export type GateId=keyof typeof GATES;
export type Permission='DOWNLOAD'|'STORE'|'DERIVE'|'DISPLAY'|'REDISTRIBUTE';
export interface SourceRecord {dataset:string;provider:string;endpointOrFile:string;licenseRef:string|null;uses:Record<Permission,boolean|null>;updateFrequency:string;asOf:string;knownAt:string;effectiveAt:string;validUntil:string;lastVerified:string;maximumAgeMs:number;adjustmentPolicy:string;coverage:{intended:number;available:number};error:string|null}
const at=(value:string)=>utcInstant(value).valueOf();
export function sourcePermission(source:SourceRecord|null,operation:Permission,asOf:string){
 if(!source)return {status:'UNKNOWN' as const,reasons:['SOURCE_MISSING']};
 const now=at(asOf),reasons:string[]=[];
 if(!source.dataset||!source.provider||!source.endpointOrFile||!source.updateFrequency||!source.adjustmentPolicy)reasons.push('SOURCE_METADATA_INCOMPLETE');
 if(!source.licenseRef||source.uses[operation]===null||source.uses[operation]===undefined)reasons.push('LICENSE_PERMISSION_UNKNOWN');
 if(source.uses[operation]===false)reasons.push('LICENSE_PERMISSION_DENIED');
 if(at(source.knownAt)>now||at(source.asOf)>now||at(source.lastVerified)>now||at(source.effectiveAt)>now)reasons.push('SOURCE_NOT_YET_KNOWN');
 if(at(source.validUntil)<=now)reasons.push('SOURCE_EXPIRED');
 if(!Number.isSafeInteger(source.maximumAgeMs)||source.maximumAgeMs<=0||now-at(source.asOf)>source.maximumAgeMs||now-at(source.lastVerified)>source.maximumAgeMs)reasons.push('SOURCE_STALE');
 if(!Number.isSafeInteger(source.coverage.intended)||!Number.isSafeInteger(source.coverage.available)||source.coverage.intended<0||source.coverage.available<0||source.coverage.available>source.coverage.intended)reasons.push('COVERAGE_INVALID');
 if(source.error)reasons.push('SOURCE_ERROR');
 return {status:reasons.includes('LICENSE_PERMISSION_DENIED')?'FAIL' as const:reasons.length?'UNKNOWN' as const:'PASS' as const,reasons};
}
export interface GateProof {id:string;gate:GateId;status:'PASS'|'FAIL'|'UNKNOWN';probeAt:string;sourceAt:string|null;expiresAt:string;sourceReference:string|null;reason:string|null;details:unknown}
export function readiness(proofs:readonly GateProof[],asOf:string){
 const now=at(asOf);
 const items=Object.entries(GATES).map(([id,definition])=>{
  const proof=proofs.filter(p=>p.gate===id&&at(p.probeAt)<=now).sort((a,b)=>at(b.probeAt)-at(a.probeAt)||a.id.localeCompare(b.id))[0];
  let status:GateProof['status']=proof?.status??'UNKNOWN',reason=proof?.reason??null;
  if(!proof){status='UNKNOWN';reason='NO_PASSING_PROOF'}
  else if(at(proof.expiresAt)<=now){status='UNKNOWN';reason='PROOF_EXPIRED'}
  else if(!['PASS','FAIL','UNKNOWN'].includes(proof.status)||at(proof.expiresAt)<=at(proof.probeAt)||proof.sourceAt&&at(proof.sourceAt)>at(proof.probeAt)){status='UNKNOWN';reason='INVALID_PROOF'}
  else if(proof.status==='PASS'&&(!proof.sourceReference||!proof.sourceAt||proof.details===null||proof.details===undefined)){status='UNKNOWN';reason='PASSING_EVIDENCE_MISSING'}
  return {gate:id,...definition,status,reason,proof:proof??null,allowedOperations:status==='PASS'?[...definition.blocks]:[],blockedOperations:status==='PASS'?[]:[...definition.blocks]};
 });
 const blocked=[...new Set(items.flatMap(item=>item.blockedOperations))];
 return {asOf,items,blockedOperations:blocked,buyAllowed:!blocked.includes('BUY'),monitoring:blocked.includes('MONITOR')?'MONITOR_DEGRADED':'READY'};
}
export function benchmarkReadiness(input:{identifier:string;identityVerified:boolean;calendarVerified:boolean;expectedSessions:readonly string[];bars:readonly {session:string;close:string;finalizedAt:string|null;adjustmentVerified:boolean;sourceRevision:string}[];asOf:string}|null){
 if(!input)return {status:'UNKNOWN',reasons:['BENCHMARK_MISSING'],riskMultiplier:'0'};
 const reasons:string[]=[],now=at(input.asOf);
 if(input.identifier!=='NIFTY_500_PRICE'||!input.identityVerified)reasons.push('BENCHMARK_IDENTITY_UNVERIFIED');
 if(!input.calendarVerified||input.expectedSessions.length<252)reasons.push('BENCHMARK_CALENDAR_INCOMPLETE');
 if(input.expectedSessions.some((session,i)=>{sessionDate(session);return session>exchangeDate(input.asOf)||(i>0&&session<=input.expectedSessions[i-1]!)}))reasons.push('BENCHMARK_CALENDAR_INVALID');
 if(input.bars.length!==input.expectedSessions.length||input.bars.some((bar,i)=>bar.session!==input.expectedSessions[i]||!bar.finalizedAt||at(bar.finalizedAt)>now||!bar.adjustmentVerified||!bar.sourceRevision||parseFixed(bar.close)<=0n))reasons.push('BENCHMARK_UNALIGNED_OR_UNVERIFIED');
 return {status:reasons.length?'UNKNOWN':'PASS',reasons,riskMultiplier:reasons.length?'0':null};
}
export function surveillance(input:{verified:boolean;knownAt:string;validUntil:string;sourceAt:string;asm:boolean|null;gsm:boolean|null;esm:boolean|null;cashTradable:boolean|null;lowerBand:string|null;upperBand:string|null}|null,asOf:string){
 if(!input)return {status:'UNKNOWN',reasons:['SURVEILLANCE_MISSING']};const now=at(asOf),reasons:string[]=[];
 if(!input.verified||at(input.knownAt)>now||at(input.sourceAt)>now||at(input.validUntil)<=now)reasons.push('SURVEILLANCE_STALE_OR_UNVERIFIED');
 if([input.asm,input.gsm,input.esm,input.cashTradable].some(value=>value===null))reasons.push('SURVEILLANCE_UNKNOWN');
 if(input.asm||input.gsm||input.esm||input.cashTradable===false)reasons.push('TRADING_RESTRICTED');
 if(input.lowerBand===null||input.upperBand===null)reasons.push('PRICE_BANDS_UNKNOWN');else if(parseFixed(input.lowerBand)<=0n||parseFixed(input.upperBand)<parseFixed(input.lowerBand))reasons.push('PRICE_BANDS_INVALID');
 return {status:reasons.includes('TRADING_RESTRICTED')?'FAIL':reasons.length?'UNKNOWN':'PASS',reasons};
}
