import {createHash} from 'node:crypto';
import {parseFixed,formatFixed,utcInstant,sessionDate,exchangeDate} from '@vcp/domain';
export interface CalendarDay {date:string;kind:'TRADING'|'SPECIAL'|'HOLIDAY';opensAt:string|null;closesAt:string|null;finalizedAt:string|null;knownAt:string;source:string;verified:boolean}
export interface DailyCandle {listingId:string;session:string;provider:string;open:string;high:string;low:string;close:string;volume:string;receivedAt:string;finalizedAt:string|null;zeroVolumeVerified:boolean}
const at=(value:string)=>utcInstant(value).valueOf();
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function verifiedCalendar(days:readonly CalendarDay[]|null,from:string,to:string,asOf:string){
 sessionDate(from);sessionDate(to);const cutoff=at(asOf);if(from>to)throw new Error('INVALID_CALENDAR_RANGE');
 if(!days)return {state:'UNKNOWN' as const,reasons:['CALENDAR_UNAVAILABLE'],sessions:[] as CalendarDay[]};
 const map=new Map<string,CalendarDay>();
 for(const day of days){sessionDate(day.date);if(map.has(day.date))throw new Error('DUPLICATE_CALENDAR_DATE');map.set(day.date,day)}
 const reasons:string[]=[],sessions:CalendarDay[]=[];
 for(let date=from;date<=to;date=new Date(at(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
  const day=map.get(date);
  if(!day||!day.verified||!day.source||at(day.knownAt)>cutoff){reasons.push('CALENDAR_UNKNOWN:'+date);continue}
  if(!['TRADING','SPECIAL','HOLIDAY'].includes(day.kind))throw new Error('INVALID_SESSION_KIND');
  if(day.kind==='HOLIDAY'){if(day.opensAt||day.closesAt||day.finalizedAt)throw new Error('INVALID_HOLIDAY_TIMING');continue}
  if(!day.opensAt||!day.closesAt||at(day.opensAt)>=at(day.closesAt)||exchangeDate(day.opensAt)!==date||exchangeDate(day.closesAt)!==date)throw new Error('INVALID_SESSION_TIMING');
  if(day.finalizedAt&&at(day.finalizedAt)<at(day.closesAt))throw new Error('PREMATURE_SESSION_FINALIZATION');
  if(day.finalizedAt&&at(day.finalizedAt)<=cutoff)sessions.push(day);
 }
 return {state:reasons.length?'UNKNOWN' as const:'KNOWN' as const,reasons,sessions};
}
export function validateCandle(bar:DailyCandle,asOf:string){
 const reasons:string[]=[];
 try{
  if(!uuid(bar.listingId)||!bar.provider.trim())throw new Error('INVALID_CANDLE_IDENTITY');sessionDate(bar.session);
  const values=[bar.open,bar.high,bar.low,bar.close].map(value=>parseFixed(value));const [open,high,low,close]=values as [bigint,bigint,bigint,bigint];
  if(values.some(value=>value<=0n)||high<open||high<close||low>open||low>close||high<low)reasons.push('INVALID_OHLC');
  if(!/^(0|[1-9]\d*)$/.test(bar.volume)||BigInt(bar.volume)>9223372036854775807n)reasons.push('INVALID_VOLUME');
  else if(BigInt(bar.volume)===0n&&!bar.zeroVolumeVerified)reasons.push('ZERO_VOLUME_UNVERIFIED');
  if(at(bar.receivedAt)>at(asOf))reasons.push('CANDLE_NOT_YET_KNOWN');
  if(bar.finalizedAt&&(at(bar.finalizedAt)>at(bar.receivedAt)||exchangeDate(bar.finalizedAt)<bar.session))reasons.push('INVALID_FINALIZATION');
 }catch(error){reasons.push(error instanceof Error&&error.message==='INVALID_CANDLE_IDENTITY'?error.message:'INVALID_CANDLE_VALUE')}
 return {valid:!reasons.length,reasons:[...new Set(reasons)]};
}
export function candleHash(bar:DailyCandle){
 return createHash('sha256').update(JSON.stringify([bar.listingId,bar.session,bar.provider,...[bar.open,bar.high,bar.low,bar.close].map(value=>formatFixed(parseFixed(value))),BigInt(bar.volume).toString(),bar.finalizedAt,bar.zeroVolumeVerified])).digest('hex');
}
export function inspectCandleBatch(input:{bars:readonly DailyCandle[];calendar:readonly CalendarDay[]|null;from:string;to:string;asOf:string;listingId:string;provider:string;requestedSessions?:readonly string[]}){
 const calendar=verifiedCalendar(input.calendar,input.from,input.to,input.asOf),groups=new Map<string,DailyCandle[]>(),quarantined:{bar:DailyCandle;reasons:string[]}[]=[];
 const requested=input.requestedSessions?new Set(input.requestedSessions):null;
 if(requested&&(requested.size!==input.requestedSessions!.length||[...requested].some(date=>!calendar.sessions.some(day=>day.date===date))))throw new Error('INVALID_REQUESTED_SESSIONS');
 for(const bar of input.bars){const check=validateCandle(bar,input.asOf);
  if(bar.listingId!==input.listingId||bar.provider!==input.provider)check.reasons.push('SOURCE_MISMATCH');
  if(bar.session<input.from||bar.session>input.to)check.reasons.push('OUTSIDE_REQUESTED_RANGE');
  if(requested&&!requested.has(bar.session))check.reasons.push('OUTSIDE_REQUESTED_RANGE');
  if(check.reasons.length){quarantined.push({bar,reasons:check.reasons});continue}
  const group=groups.get(bar.session)??[];group.push(bar);groups.set(bar.session,group);
 }
 const accepted:DailyCandle[]=[];
 for(const [session,bars] of groups){
  if(new Set(bars.map(candleHash)).size>1){quarantined.push(...bars.map(bar=>({bar,reasons:['CONTRADICTORY_DUPLICATE']})));continue}
  const bar=bars[0]!,day=calendar.sessions.find(day=>day.date===session);
  if(!day){quarantined.push({bar,reasons:['SESSION_NOT_FINAL_OR_UNVERIFIED']});continue}
  if(!bar.finalizedAt||at(bar.finalizedAt)<at(day.finalizedAt!)){quarantined.push({bar,reasons:['CANDLE_NOT_FINAL']});continue}
  accepted.push(bar);
 }
 accepted.sort((a,b)=>a.session.localeCompare(b.session));
 const expected=calendar.sessions.filter(day=>!requested||requested.has(day.date));
 const missing=expected.filter(day=>!accepted.some(bar=>bar.session===day.date)).map(day=>({session:day.date,reason:'DATA_INCOMPLETE'}));
 return {state:calendar.state==='UNKNOWN'?'UNKNOWN' as const:missing.length||quarantined.length?'INCOMPLETE' as const:'COMPLETE' as const,accepted,quarantined,missing,calendarReasons:calendar.reasons,expectedCount:expected.length,actualCount:accepted.length};
}
