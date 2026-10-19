import {createHash} from 'node:crypto';
import {utcInstant,exchangeDate,sessionDate} from '@vcp/domain';
import {inspectCandleBatch,verifiedCalendar,candleHash,type DailyCandle,type CalendarDay} from './candles.js';
import {validateInstrumentSnapshot,type InstrumentSnapshot} from './instruments.js';
import type {HistoricalWindow} from './historical-transport.js';
export interface HistoricalResponseInput {listingId:string;request:HistoricalWindow;mapping:InstrumentSnapshot|null;calendar:readonly CalendarDay[]|null;receivedAt:string;rows:readonly unknown[]}
/** Numbers must be original JSON lexemes; JS floating-point prices are never reconstructed. */
export function normalizeHistoricalResponse(input:HistoricalResponseInput){
 const provider='ANGEL_ONE',date=exchangeDate(input.receivedAt),{request}=input;
 sessionDate(request.from);sessionDate(request.to);
 const calendar=verifiedCalendar(input.calendar,request.from,request.to,input.receivedAt);
 const identityReasons:string[]=[];
 if(input.mapping){validateInstrumentSnapshot(input.mapping);if(utcInstant(input.mapping.knownAt)>utcInstant(input.receivedAt))identityReasons.push('MAPPING_NOT_YET_KNOWN')}
 const matches=input.mapping?.rows.filter(row=>row.listingId===input.listingId&&row.provider===provider&&row.exchange===request.exchange&&row.token===request.symbolToken&&row.verified&&row.enabled&&row.validFrom<=date&&(row.validTo===null||row.validTo>date)&&row.instrumentType==='EQUITY'&&((row.exchange==='NSE'&&row.series==='EQ')||(row.exchange==='BSE'&&row.series==='CASH')))??[];
 if(matches.length!==1)identityReasons.push('SOURCE_MAPPING_MISMATCH');
 const malformed:{index:number;reason:string}[]=[],bars:DailyCandle[]=[];
 if(!identityReasons.length)for(const [index,row] of input.rows.entries()){
  if(!Array.isArray(row)||row.length!==6||row.some(value=>typeof value!=='string')){malformed.push({index,reason:'INVALID_CANDLE_TUPLE'});continue}
  const timestamp=row[0] as string;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/.test(timestamp)){malformed.push({index,reason:'INVALID_PROVIDER_TIMESTAMP'});continue}
  const session=timestamp.slice(0,10);try{sessionDate(session)}catch{malformed.push({index,reason:'INVALID_PROVIDER_TIMESTAMP'});continue}
  const instant=new Date(timestamp);if(!Number.isFinite(instant.valueOf())||timestamp.slice(11,19)!==new Date(instant.valueOf()+19800000).toISOString().slice(11,19)){malformed.push({index,reason:'INVALID_PROVIDER_TIMESTAMP'});continue}
  if(session<matches[0]!.listingDate){malformed.push({index,reason:'CANDLE_BEFORE_LISTING'});continue}
  const day=calendar.sessions.find(day=>day.date===session);
  if(!day||(timestamp.slice(11,19)!=='00:00:00'&&instant.valueOf()!==new Date(day.opensAt!).valueOf())){malformed.push({index,reason:'SESSION_TIMESTAMP_MISMATCH'});continue}
  bars.push({listingId:input.listingId,provider,session,open:row[1] as string,high:row[2] as string,low:row[3] as string,close:row[4] as string,volume:row[5] as string,receivedAt:input.receivedAt,finalizedAt:day.finalizedAt,zeroVolumeVerified:false});
 }
 const inspected=inspectCandleBatch({listingId:input.listingId,provider,bars,calendar:input.calendar,from:request.from,to:request.to,asOf:input.receivedAt});
 const reasons=[...identityReasons,...inspected.calendarReasons,...malformed.map(row=>row.reason),...inspected.quarantined.flatMap(row=>row.reasons)];
 if(inspected.missing.length)reasons.push('DATA_INCOMPLETE');
 if(input.rows.length===500&&inspected.missing.length)reasons.push('POSSIBLE_500_RECORD_TRUNCATION');
 const status=identityReasons.length||calendar.state==='UNKNOWN'?'UNKNOWN':reasons.length?'INCOMPLETE':'COMPLETE';
 const observed=inspected.accepted.map(bar=>({session:bar.session,hash:candleHash(bar)}));
 return {status,listingId:input.listingId,provider,request,receivedAt:input.receivedAt,mappingSnapshotId:input.mapping?.id??null,rawResponseCount:input.rows.length,actualCount:inspected.actualCount,expectedCount:inspected.expectedCount,actualFrom:observed[0]?.session??null,actualTo:observed.at(-1)?.session??null,missing:inspected.missing,reasons:[...new Set(reasons)],malformed,quarantined:inspected.quarantined,bars:inspected.accepted,observed,dataRevision:createHash('sha256').update(JSON.stringify(observed)).digest('hex')};
}
