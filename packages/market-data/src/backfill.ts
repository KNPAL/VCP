import {sessionDate} from '@vcp/domain';
import {verifiedCalendar,type CalendarDay} from './candles.js';
export const dateAfter=(date:string,days:number)=>new Date(new Date(date+'T00:00:00Z').valueOf()+days*86400000).toISOString().slice(0,10);
export const calendarDays=(from:string,to:string)=>(new Date(to).valueOf()-new Date(from).valueOf())/86400000+1;
export interface BackfillWindow {from:string;to:string;sessions:string[]}
export function backfillHorizon(to:string){sessionDate(to);const year=Number(to.slice(0,4))-5,monthDay=to.slice(4);let from=String(year)+monthDay;try{sessionDate(from)}catch{from=String(year)+'-02-28'}return {from,to}}
export function missingWindows(sessions:readonly string[],storedSessions:readonly string[],maxDays=400):BackfillWindow[]{
 if(!Number.isSafeInteger(maxDays)||maxDays<7||maxDays>400)throw new Error('INVALID_BACKFILL_WINDOW_SIZE');
 const stored=new Set(storedSessions);for(const date of [...sessions,...storedSessions])sessionDate(date);
 if(sessions.some((date,i)=>i>0&&date<=sessions[i-1]!))throw new Error('INVALID_BACKFILL_SESSIONS');
 const result:BackfillWindow[]=[];let current:BackfillWindow|undefined;
 for(const date of sessions){if(stored.has(date)){current=undefined;continue}if(!current||calendarDays(current.from,date)>maxDays){current={from:date,to:date,sessions:[]};result.push(current)}current.to=date;current.sessions.push(date)}
 return result;
}
export function planBackfill(input:{to:string;asOf:string;calendar:readonly CalendarDay[]|null;storedSessions:readonly string[];availableFrom?:string}){
 const horizon=backfillHorizon(input.to);if(input.availableFrom){sessionDate(input.availableFrom);if(input.availableFrom>horizon.to)throw new Error('INVALID_LISTING_START');if(input.availableFrom>horizon.from)horizon.from=input.availableFrom}
 const calendar=verifiedCalendar(input.calendar,horizon.from,horizon.to,input.asOf);
 const sessions=calendar.sessions.map(day=>day.date);
 return {state:calendar.state,reasons:calendar.reasons,...horizon,targetSessions:450,availableSessions:sessions.length,historyState:calendar.state==='UNKNOWN'?'UNKNOWN':sessions.length>=450?'SUFFICIENT':'INSUFFICIENT_AVAILABLE_HISTORY',windows:calendar.state==='KNOWN'?missingWindows(sessions,input.storedSessions):[]};
}
/** Halve incomplete requests, but never shrink a request below seven calendar days. */
export function splitBackfillWindow(window:BackfillWindow,missing:readonly string[]):BackfillWindow[]{
 const days=calendarDays(window.from,window.to);if(days<=7)return [];
 const size=Math.max(7,Math.ceil(days/2)),needed=new Set(missing);
 return [{from:window.from,to:dateAfter(window.from,size-1)},{from:dateAfter(window.to,1-size),to:window.to}].map(range=>({...range,sessions:window.sessions.filter(date=>date>=range.from&&date<=range.to)})).filter(range=>range.sessions.some(date=>needed.has(date)));
}
