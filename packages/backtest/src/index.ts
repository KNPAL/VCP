import {createHash} from 'node:crypto';
import {utcInstant,exchangeDate,sessionDate,parseFixed} from '@vcp/domain';
import {universeAt,canonicalListings,verifiedCalendar,adjustCandles,validateCandle,type UniverseSnapshot,type InstrumentSnapshot,type CalendarDay,type ActionSnapshot,type DailyCandle} from '@vcp/market-data';

export interface HistoricalInputs {
 from:string;through:string;historyFrom?:string;knownAt:string;strategySha:string;strategyConfiguration:Record<string,unknown>;seed:number;
 fees:{buyBps:string;sellBps:string;slippageBps:string;minimumFee:string;sourceReference:string};
 historicalDelistingsVerified:boolean;
 universes:UniverseSnapshot[];instruments:InstrumentSnapshot[];calendar:CalendarDay[];actions:ActionSnapshot[];
 raw:(DailyCandle&{revisionId:string;revision:number})[];
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const at=(value:string)=>utcInstant(value).valueOf();
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
export interface HistoricalSnapshot {id:string;strategyHash:string;dataRevision:string;inputs:HistoricalInputs;executable:false;performanceVerified:false}
/** Content-addressed, detached inputs. Storage adapters must persist the complete envelope. */
export function pinHistoricalSnapshot(input:HistoricalInputs):HistoricalSnapshot {
 const copy=JSON.parse(canonical(input)) as HistoricalInputs;
 sessionDate(copy.from);sessionDate(copy.through);at(copy.knownAt);
 if(copy.from>copy.through||copy.through>exchangeDate(copy.knownAt))throw new Error('INVALID_HISTORICAL_RANGE');
 if(copy.historyFrom){sessionDate(copy.historyFrom);if(copy.historyFrom>copy.from)throw new Error('INVALID_WARMUP_RANGE')}
 if(!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(copy.strategySha)||!Number.isSafeInteger(copy.seed)||copy.seed<0||copy.seed>4294967295)throw new Error('INVALID_REPLAY_IDENTITY');
 if(!copy.fees.sourceReference.trim()||!Object.keys(copy.strategyConfiguration).length)throw new Error('REPLAY_CONFIGURATION_REQUIRED');
 for(const key of ['buyBps','sellBps','slippageBps','minimumFee'] as const){const n=parseFixed(copy.fees[key]);if(n<0n||(key!=='minimumFee'&&n>10000n*1000000n))throw new Error('INVALID_REPLAY_COST')}
 const cutoff=at(copy.knownAt);
 for(const rows of [copy.universes,copy.instruments,copy.calendar,copy.actions])if(rows.some(row=>at(row.knownAt)>cutoff))throw new Error('SNAPSHOT_FUTURE_INPUT');
 const ids=new Set<string>(),versions=new Set<string>();
 for(const bar of copy.raw){
  const key=bar.listingId+'|'+bar.session+'|'+bar.revision;
  if(!bar.revisionId||ids.has(bar.revisionId)||versions.has(key)||!Number.isSafeInteger(bar.revision)||bar.revision<1||!validateCandle(bar,copy.knownAt).valid)throw new Error('INVALID_RAW_REVISION');
  ids.add(bar.revisionId);versions.add(key);
 }
 const strategyHash=hash(copy.strategyConfiguration),dataRevision=hash({raw:copy.raw,actions:copy.actions});
 return freeze({id:hash(copy),strategyHash,dataRevision,inputs:copy,executable:false as const,performanceVerified:false as const});
}
/** Rebuild the price scale at each decision instant, never using a later revision or action. */
export function historicalSlice(snapshot:HistoricalSnapshot,asOf:string){
 if(hash(snapshot.inputs)!==snapshot.id||hash(snapshot.inputs.strategyConfiguration)!==snapshot.strategyHash||hash({raw:snapshot.inputs.raw,actions:snapshot.inputs.actions})!==snapshot.dataRevision)throw new Error('SNAPSHOT_INTEGRITY_FAILED');
 const input=snapshot.inputs,cutoff=at(asOf),date=exchangeDate(asOf);
 if(cutoff>at(input.knownAt)||date<input.from||date>input.through)throw new Error('REPLAY_OUTSIDE_SNAPSHOT');
 const historyFrom=input.historyFrom??input.from;
 const universe=universeAt(input.universes,asOf),mappings=canonicalListings(input.instruments,universe.members,asOf),calendar=verifiedCalendar(input.calendar,historyFrom,date,asOf);
 const reasons=[...calendar.reasons,...(universe.reason?[universe.reason]:[])];
 const selected=mappings.map(mapping=>{
  if(!mapping.primary){reasons.push(mapping.reason+':'+mapping.isin);return {isin:mapping.isin,listingId:null,adjustment:null}}
  const listingId=mapping.primary.listingId,visible=new Map<string,HistoricalInputs['raw'][number]>();
  for(const bar of input.raw){
   if(bar.listingId!==listingId||bar.session<historyFrom||bar.session<mapping.primary.listingDate||bar.session>date||at(bar.receivedAt)>cutoff||!bar.finalizedAt||at(bar.finalizedAt)>cutoff)continue;
   const day=calendar.sessions.find(day=>day.date===bar.session);
   if(!day||at(bar.finalizedAt)<at(day.finalizedAt!))continue;
   const previous=visible.get(bar.session);if(!previous||bar.revision>previous.revision)visible.set(bar.session,bar);
  }
  for(const day of calendar.sessions)if(day.date>=mapping.primary.listingDate&&!visible.has(day.date))reasons.push('DATA_GAP:'+listingId+':'+day.date);
  const source=input.actions.filter(row=>row.listingId===listingId&&at(row.knownAt)<=cutoff).sort((a,b)=>at(b.knownAt)-at(a.knownAt)||a.id.localeCompare(b.id))[0];
  if(!source||!visible.size){reasons.push((!source?'ACTION_HISTORY_MISSING:':'RAW_HISTORY_MISSING:')+listingId);return {isin:mapping.isin,listingId,adjustment:null}}
  const adjustment=adjustCandles({listingId,asOf,scaleSession:date,source,raw:[...visible.values()]});
  reasons.push(...adjustment.reasons.map(reason=>reason+':'+listingId));
  return {isin:mapping.isin,listingId,adjustment};
 });
 const bias=universe.bias||(!input.historicalDelistingsVerified?'SURVIVORSHIP_BIASED_RESEARCH':null);
 if(bias)reasons.push(bias);
 return freeze({snapshotId:snapshot.id,asOf,strategyHash:snapshot.strategyHash,dataRevision:snapshot.dataRevision,universe,calendar,selected,reasons:[...new Set(reasons)].sort(),bias,executable:false as const,performanceVerified:false as const});
}
export * from './chronology.js';
export * from './entry-fill.js';
export * from './daily-exit.js';
export * from './paper-ledger.js';
export * from './paper-protection.js';
export * from './opening-exit.js';
export * from './performance.js';
export * from './walk-forward.js';
