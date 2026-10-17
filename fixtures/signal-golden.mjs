import {evaluateBreakout,REQUIRED_RISK_GATES} from '../packages/strategy/dist/index.js';
// Explicit synthetic calendar, never inferred as a real exchange schedule.
export const dates=Array.from({length:53},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
export const clock=(i,time)=>dates[i]+'T'+time+'Z';
export function breakoutInput(){return {previous:{listingId:'00000000-0000-4000-8000-000000000001',patternId:'b'.repeat(64),session:dates[49],state:'READY',pivot:'100',lastLow:'94',asOf:clock(49,'11:00:00'),configHash:'a'.repeat(64),dataRevision:'r0'},
 today:{session:dates[50],close:'101',volume:'1500',endedAt:clock(50,'10:00:00'),finalizedAt:clock(50,'11:00:00'),revision:'r1'},
 priorBars:dates.slice(0,50).map((session,i)=>({session,close:'99',volume:'1000',endedAt:clock(i,'10:00:00'),finalizedAt:clock(i,'11:00:00'),revision:'prior-'+i})),
 tick:'0.05',verifiedSessions:dates,evidence:{configHash:'a'.repeat(64),dataRevision:'r1',decidedAt:clock(50,'11:00:00')}}}
export function entryInput(){return {event:evaluateBreakout(breakoutInput()).event,now:clock(51,'06:00:00'),calendar:dates.map((date,i)=>({date,opensAt:clock(i,'04:00:00'),closesAt:clock(i,'10:00:00')})),continuousMarket:'PASS',quote:{price:'101',at:clock(51,'06:00:00')},heartbeatAt:clock(51,'06:00:00'),brokerConnected:'PASS',sessionValid:'PASS',tokenValid:'PASS',brokerSettled:'PASS',gates:{G04:'PASS',G05:'PASS',G06:'PASS',G08:'PASS'},riskGates:Object.fromEntries(REQUIRED_RISK_GATES.map(key=>[key,'PASS'])),regime:'GREEN',tick:'0.05'}}
