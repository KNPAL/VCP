import { InputError, parseFixed } from './decimal.js';
import { utcInstant } from './time.js';
export const PatternStates = ['DISCOVERED','DEVELOPING','WATCH','WATCH_DATA','READY','BREAKOUT_CONFIRMED','BREAKOUT_PRICE_ONLY','EXPIRED','INVALIDATED'] as const;
export const SignalStates = ['PROVISIONAL_CROSS','BREAKOUT_CONFIRMED','BREAKOUT_PRICE_ONLY','BUY_ELIGIBLE','BUY_BLOCKED','MISSED_ENTRY','EXPIRED'] as const;
export const PositionStates = ['OPEN','PARTIALLY_EXITED','EXIT_ALERTED','CLOSED'] as const;
export const FeedStates = ['CONNECTED','RECONNECTING','STALE','DISCONNECTED','MONITOR_DEGRADED'] as const;
export const errorCodes = {400:'INVALID_INPUT',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'STALE_CONFLICT',422:'DOMAIN_REJECTED',429:'RATE_LIMITED',500:'INTERNAL_ERROR',503:'BROKER_UNAVAILABLE'} as const;
export const wireSchemas = {
 Decimal: {type:'string',pattern:'^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$'},
 Timestamp: {type:'string',format:'date-time',pattern:'Z$'},
 SessionDate: {type:'string',format:'date'},
 PatternState: {type:'string',enum:PatternStates},
 SignalState: {type:'string',enum:SignalStates},
 PositionState: {type:'string',enum:PositionStates},
 FeedState: {type:'string',enum:FeedStates},
 Error: {type:'object',additionalProperties:false,required:['error','at'],properties:{
  error:{type:'object',additionalProperties:false,required:['code','message','details','requestId'],properties:{code:{type:'string'},message:{type:'string'},details:{},requestId:{type:'string'}}},
  at:{type:'string',format:'date-time'}
 }},
} as const;
export function wireDecimal(value:unknown):string {
 if(typeof value!=='string') throw new InputError('Wire decimals must be strings');
 parseFixed(value); return value;
}
export function wireTimestamp(value:unknown):string {
 if(typeof value!=='string') throw new InputError('Timestamp must be a string');
 utcInstant(value); return value;
}
export function sessionDate(value:unknown):string {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('Session date required');
 utcInstant(value+'T00:00:00Z'); return value;
}
export function enumValue<T extends string>(allowed:readonly T[],value:unknown):T {
 if(typeof value!=='string' || !allowed.includes(value as T)) throw new InputError('Invalid state');
 return value as T;
}
