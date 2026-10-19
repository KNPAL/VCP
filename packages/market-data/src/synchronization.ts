import {sessionDate,utcInstant} from '@vcp/domain';
import {verifiedCalendar,type CalendarDay,type DailyCandle} from './candles.js';
import {calendarDays} from './backfill.js';

export interface SyncInput {
 listingId:string; provider:string; from:string; to:string; asOf:string;
 calendar:readonly CalendarDay[]|null; storedSessions:readonly string[];
}
export interface SyncRange {from:string;to:string;sessions:string[]}
/** Inventory is read from committed final bars, never from a broker response count. */
export function planSynchronization(input:SyncInput){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.listingId)||!input.provider.trim())throw new Error('INVALID_SYNC_IDENTITY');
 const calendar=verifiedCalendar(input.calendar,input.from,input.to,input.asOf);
 for(const date of input.storedSessions)sessionDate(date);
 if(calendar.state==='UNKNOWN')return {state:'UNKNOWN' as const,reasons:calendar.reasons,ranges:[] as SyncRange[],missing:[] as string[],overlap:[] as string[]};
 const sessions=calendar.sessions.map(day=>day.date),stored=new Set(input.storedSessions);
 const missing=sessions.filter(date=>!stored.has(date)),overlap=sessions.slice(-3),wanted=new Set([...missing,...overlap]);
 const ranges:SyncRange[]=[];let current:SyncRange|undefined;
 for(const date of sessions){
  if(!wanted.has(date)){current=undefined;continue}
  if(!current||calendarDays(current.from,date)>400){current={from:date,to:date,sessions:[]};ranges.push(current)}
  current.to=date;current.sessions.push(date);
 }
 return {state:'KNOWN' as const,reasons:[] as string[],ranges,missing,overlap};
}

export interface SyncDependencies<Result> {
 /** Must use the account-wide broker limiter and licensed source adapter. */
 fetch:(range:SyncRange)=>Promise<readonly DailyCandle[]>;
 now:()=>string;
 commit:(input:{listingId:string;provider:string;from:string;to:string;asOf:string;calendar:readonly CalendarDay[]|null;bars:readonly DailyCandle[];requestedSessions:readonly string[]})=>Promise<Result>;
}
/** Commit only after all requests succeed. Corrections and gaps use the same atomic ingestion path. */
export async function synchronizeCandles<Result>(input:SyncInput,deps:SyncDependencies<Result>){
 const plan=planSynchronization(input);
 if(plan.state==='UNKNOWN')return {state:'UNKNOWN' as const,reason:'CALENDAR_UNAVAILABLE',plan};
 if(!plan.ranges.length)return {state:'IDLE' as const,reason:'NO_FINALIZED_SESSIONS',plan};
 const bars:DailyCandle[]=[];
 for(const range of plan.ranges){
  let response:readonly DailyCandle[];
  try{response=await deps.fetch(range)}catch{return {state:'FAILED' as const,reason:'BROKER_FETCH_FAILED',plan,failedRange:range}}
  // Reject stale/cached responses for a different request; never broaden ingestion implicitly.
  if(response.some(bar=>bar.listingId!==input.listingId||bar.provider!==input.provider||bar.session<range.from||bar.session>range.to))return {state:'FAILED' as const,reason:'BROKER_RESPONSE_SCOPE_MISMATCH',plan,failedRange:range};
  bars.push(...response);
 }
 const asOf=deps.now();if(utcInstant(asOf)<utcInstant(input.asOf))throw new Error('SYNC_CLOCK_REGRESSION');
 const report=await deps.commit({listingId:input.listingId,provider:input.provider,from:input.from,to:plan.ranges.at(-1)!.to,asOf,calendar:input.calendar,bars,requestedSessions:plan.ranges.flatMap(range=>range.sessions)});
 return {state:'COMMITTED' as const,plan,report};
}
