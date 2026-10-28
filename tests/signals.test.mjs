import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBreakout,breakoutBeforeRecompute,structuralStop,evaluateEntry} from '../packages/strategy/dist/index.js';
import {clock,breakoutInput,entryInput} from '../fixtures/signal-golden.mjs';
test('breakout uses completed current candle and frozen prior READY pivot with exact volume boundary',()=>{
 const input=breakoutInput();const first=evaluateBreakout(input);assert.equal(first.state,'BREAKOUT_CONFIRMED');
 assert.deepEqual(first,evaluateBreakout(structuredClone(input)));
 input.today.volume='1499';assert.equal(evaluateBreakout(input).state,'BREAKOUT_PRICE_ONLY');
 input.today.close='100';assert.equal(evaluateBreakout(input).state,'NO_CROSS');
 input.today.close='101';input.priorBars[49].close='100.05';assert.equal(evaluateBreakout(input).state,'NO_CROSS');
});
test('missing, late or future data cannot confirm a breakout',()=>{
 for(const alter of [x=>x.today.finalizedAt=null,x=>x.evidence.decidedAt=clock(50,'10:30:00'),x=>x.previous=null,x=>x.priorBars.pop(),x=>x.verifiedSessions=null,x=>x.previous.state='WATCH',x=>x.previous.asOf=clock(51,'11:00:00'),x=>x.priorBars[0].finalizedAt=clock(51,'11:00:00')]){
  const input=breakoutInput();alter(input);assert.equal(evaluateBreakout(input).state,'UNKNOWN');
 }
 const zero=breakoutInput();zero.priorBars.forEach(x=>x.volume='0');assert.equal(evaluateBreakout(zero).state,'UNKNOWN');
});
test('market event is persisted before detector recomputation and a failed write prevents recompute',async()=>{
 const calls=[];await breakoutBeforeRecompute(breakoutInput(),async()=>calls.push('persist'),async()=>calls.push('detect'));
 assert.deepEqual(calls,['persist','detect']);
 await assert.rejects(breakoutBeforeRecompute(breakoutInput(),async()=>{throw new Error('DB_DOWN')},async()=>calls.push('unexpected')));
 assert.equal(calls.length,2);
});
test('structural stop rounds down one tick below low and never tightens to satisfy risk',()=>{
 assert.equal(structuralStop('94.02','0.05','101').stop,'93.950000');
 assert.deepEqual(structuralStop('92.05','0.05','100').reasons,[]);
 const wide=structuralStop('92','0.05','100');assert.equal(wide.stop,'91.950000');assert.ok(wide.reasons.includes('STOP_WIDER_THAN_8_PERCENT'));
 assert.ok(structuralStop('102','0.05','100').reasons.includes('STOP_NOT_BELOW_ENTRY'));
});
test('entry allows only next two sessions and exact chase boundary; no fabricated fill',()=>{
 const input=entryInput();const decision=evaluateEntry(input);assert.equal(decision.state,'BUY_ELIGIBLE');assert.equal(Date.parse(decision.expiresAt)-Date.parse(decision.decidedAt),30000);
 input.event.lastLow='95';input.quote.price='103';assert.equal(evaluateEntry(input).state,'BUY_ELIGIBLE');
 input.quote.price='103.000001';assert.ok(evaluateEntry(input).reasons.includes('MISSED_ENTRY'));
 input.quote.price='100';assert.ok(evaluateEntry(input).reasons.includes('NO_LONGER_ABOVE_PIVOT'));
 input.now=clock(50,'09:00:00');assert.ok(evaluateEntry(input).reasons.includes('OUTSIDE_ENTRY_SESSION'));
 input.now=clock(52,'10:00:00');assert.ok(evaluateEntry(input).reasons.includes('ENTRY_WINDOW_EXPIRED'));
 assert.equal(Object.hasOwn(decision,'fill'),false);
});
test('unknown portfolio gates and stale broker/quotes block all reasons without changing market signal',()=>{
 const input=entryInput(),original=structuredClone(input.event);
 input.quote.at=clock(51,'05:59:00');input.heartbeatAt=clock(51,'05:59:30');assert.equal(evaluateEntry(input).state,'BUY_ELIGIBLE');
 input.quote.at=clock(51,'05:58:59');input.heartbeatAt=clock(51,'05:59:29');input.riskGates.POSITION_CAP='FAIL';input.gates.G04='UNKNOWN';input.regime='RED';
 const result=evaluateEntry(input);assert.equal(result.state,'BUY_BLOCKED');
 for(const code of ['QUOTE_STALE','HEARTBEAT_STALE','POSITION_CAP_FAILED','G04_UNKNOWN','REGIME_RED'])assert.ok(result.reasons.includes(code));
 assert.deepEqual(input.event,original);assert.equal(input.event.type,'BREAKOUT_CONFIRMED');
 input.riskGates={};assert.ok(evaluateEntry(input).reasons.includes('CASH_UNKNOWN'));
 input.quote=null;assert.ok(evaluateEntry(input).reasons.includes('QUOTE_UNKNOWN'));
});
test('entry deadline never outlives heartbeat, quote or exchange session evidence',()=>{
 const cases=[
  [input=>input.heartbeatAt=clock(51,'05:59:40'),clock(51,'06:00:10')],
  [input=>input.quote.at=clock(51,'05:59:15'),clock(51,'06:00:15')],
  [input=>input.calendar[51].closesAt=clock(51,'06:00:05'),clock(51,'06:00:05')],
  [input=>input.heartbeatAt=clock(51,'05:59:30'),clock(51,'06:00:00')]
 ];
 for(const [change,deadline] of cases){const input=entryInput();change(input);const plan=evaluateEntry(input);assert.equal(plan.state,'BUY_ELIGIBLE');assert.equal(plan.expiresAt,new Date(deadline).toISOString())}
 const stale=entryInput();stale.heartbeatAt=clock(51,'05:59:29');assert.equal(evaluateEntry(stale).state,'BUY_BLOCKED');assert.equal(evaluateEntry(stale).expiresAt,new Date(stale.now).toISOString());
});

test('entry window counts exchange sessions across closures and late finalization never extends it',()=>{
 const input=entryInput();
 input.calendar=[
  {date:input.event.session,opensAt:clock(50,'04:00:00'),closesAt:clock(50,'10:00:00')},
  {date:'2026-03-02',opensAt:'2026-03-02T04:00:00Z',closesAt:'2026-03-02T10:00:00Z'},
  {date:'2026-03-05',opensAt:'2026-03-05T04:00:00Z',closesAt:'2026-03-05T10:00:00Z'},
  {date:'2026-03-06',opensAt:'2026-03-06T04:00:00Z',closesAt:'2026-03-06T10:00:00Z'}
 ];
 const run=now=>{input.now=now;input.quote.at=now;input.heartbeatAt=now;return evaluateEntry(input)};
 assert.equal(run('2026-03-02T04:00:00Z').state,'BUY_ELIGIBLE');
 assert.ok(run('2026-03-03T06:00:00Z').reasons.includes('OUTSIDE_ENTRY_SESSION'));
 assert.equal(run('2026-03-05T09:59:59Z').state,'BUY_ELIGIBLE');
 assert.equal(run('2026-03-05T09:59:59Z').expiresAt,'2026-03-05T10:00:00.000Z');
 assert.ok(run('2026-03-05T10:00:00Z').reasons.includes('ENTRY_WINDOW_EXPIRED'));
 input.event.observedAt='2026-03-06T04:00:00Z';input.event.decidedAt=input.event.observedAt;
 assert.ok(run('2026-03-06T05:00:00Z').reasons.includes('ENTRY_WINDOW_EXPIRED'));
 input.calendar=input.calendar.slice(0,2);assert.ok(run('2026-03-02T05:00:00Z').reasons.includes('CALENDAR_INCOMPLETE'));
});
