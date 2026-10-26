import {sessionDate,utcInstant} from '@vcp/domain';
import {backfillHorizon,missingWindows,dateAfter} from './backfill.js';
import {verifiedCalendar,inspectCandleBatch,type CalendarDay,type DailyCandle} from './candles.js';

export interface DownloadRangeInput {
 fromDate:string;toDate:string;interval:'1d';mode:'MISSING_ONLY'|'RECONCILE';asOf:string;
 listingId:string;provider:string;listingDate:string;calendar:readonly CalendarDay[]|null;
 bars:readonly DailyCandle[];providerFinalSession:string|null;
}
/** Pure local coverage planning. The caller must bind source permissions and immutable revisions. */
export function previewDownloadRange(input:DownloadRangeInput){
 const {fromDate,toDate,asOf}=input;sessionDate(fromDate);sessionDate(toDate);sessionDate(input.listingDate);utcInstant(asOf);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.listingId)||!input.provider.trim())throw new Error('INVALID_DOWNLOAD_IDENTITY');
 if(input.interval!=='1d')throw new Error('UNSUPPORTED_DOWNLOAD_INTERVAL');
 if(!['MISSING_ONLY','RECONCILE'].includes(input.mode))throw new Error('INVALID_DOWNLOAD_MODE');
 if(fromDate>toDate||fromDate<backfillHorizon(toDate).from)throw new Error('INVALID_DOWNLOAD_RANGE');
 if(input.providerFinalSession){sessionDate(input.providerFinalSession);if(toDate>input.providerFinalSession)throw new Error('SESSION_NOT_PROVIDER_FINALIZED')}
 const from=input.listingDate>fromDate?input.listingDate:fromDate;
 const empty={checkedAt:asOf,fromDate,toDate,interval:input.interval,mode:input.mode,targetSessions:450,availableSessions:null as number|null,historyState:'UNKNOWN' as string,alreadyStoredCount:0,missingCount:null as number|null,invalidCount:0,missingSessions:[] as string[],reconcileSessions:[] as string[],rangesToFetch:[] as ReturnType<typeof missingWindows>,planWindowCount:0,estimatedRequestCount:0};
 if(from>toDate)return {...empty,state:'BLOCKED' as const,reasons:['BEFORE_LISTING'],excludedDates:[{from:fromDate,to:toDate,reason:'BEFORE_LISTING'}]};
 const excludedDates:{from:string;to:string;reason:string}[]=from>fromDate?[{from:fromDate,to:dateAfter(from,-1),reason:'BEFORE_LISTING'}]:[];
 const calendar=verifiedCalendar(input.calendar,from,toDate,asOf);
 if(calendar.state==='UNKNOWN')return {...empty,state:'UNKNOWN' as const,reasons:calendar.reasons,excludedDates};
 const sessions=calendar.sessions.map(day=>day.date),wanted=new Set(sessions);
 for(const day of input.calendar??[])if(day.date>=from&&day.date<=toDate&&!wanted.has(day.date))excludedDates.push({from:day.date,to:day.date,reason:day.kind==='HOLIDAY'?'HOLIDAY':'SESSION_NOT_FINALIZED'});
 const bars=input.bars.filter(bar=>bar.session>=from&&bar.session<=toDate);
 const inspected=inspectCandleBatch({bars,calendar:input.calendar,from,to:toDate,asOf,listingId:input.listingId,provider:input.provider});
 const stored=inspected.accepted.map(bar=>bar.session),present=new Set(stored),missingSessions=sessions.filter(day=>!present.has(day));
 // Refresh the latest three finalized sessions within the requested range, including stored bars.
 const reconcileSessions=input.mode==='RECONCILE'?sessions.slice(-3):[];
 const refreshing=new Set(reconcileSessions),rangesToFetch=missingWindows(sessions,stored.filter(day=>!refreshing.has(day)));
 const reasons=input.providerFinalSession?[]:['PROVIDER_FINAL_SESSION_UNKNOWN'];
 return {...empty,targetSessions:450,availableSessions:sessions.length,historyState:sessions.length>=450?'SUFFICIENT':'INSUFFICIENT_AVAILABLE_HISTORY',state:reasons.length?'BLOCKED' as const:'KNOWN' as const,reasons,excludedDates,alreadyStoredCount:stored.length,missingCount:missingSessions.length,invalidCount:inspected.quarantined.length,missingSessions,reconcileSessions,rangesToFetch,planWindowCount:rangesToFetch.length,estimatedRequestCount:rangesToFetch.length};
}
