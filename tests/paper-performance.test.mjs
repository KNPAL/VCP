import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperLedger,appendPaperFill,paperPerformance} from '../packages/backtest/dist/index.js';
function fixture(){
 const dates=['2026-10-20','2026-10-21','2026-10-22'],isin='INE000000001';
 let ledger=createPaperLedger('performance','1000',dates[0]+'T03:45:00Z');const initialRisks=[];
 for(let i=0;i<dates.length;i++){
  const date=dates[i],buyAt=date+'T04:00:00Z',sellAt=date+'T05:00:00Z';
  const append=(id,side,price,when)=>{ledger=appendPaperFill(ledger,{id,sourceDecisionId:id,expectedLedgerRevision:ledger.revision,isin,side,quantity:1,price,fees:'0',modeledAt:when,decidedAt:when,simulated:true,executable:false})};
  append('buy-'+date,'BUY','100',buyAt);initialRisks.push({episodeId:ledger.events.at(-1).id,riskAmount:'10',knownAt:buyAt,regime:['GREEN','RED','YELLOW'][i]});
  append('sell-'+date,'SELL',['110','95','100'][i],sellAt);
 }
 return {ledger,asOf:dates[2]+'T11:00:00Z',calendar:dates.map(date=>({date,kind:'TRADING',opensAt:date+'T03:45:00Z',closesAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',knownAt:'2026-10-19T00:00:00Z',source:'fixture',verified:true})),days:dates.map(session=>({session,asOf:session+'T11:00:00Z',marks:[],regime:{state:'GREEN',knownAt:session+'T10:30:00Z',revision:'regime-'+session}})),initialRisks,signals:[{id:'signal-1',decidedAt:dates[0]+'T03:00:00Z'},{id:'signal-2',decidedAt:dates[1]+'T03:00:00Z'}],entryDecisions:[{id:'entry-1',marketEventId:'signal-1',decidedAt:dates[0]+'T03:45:00Z',state:'SIMULATED_FILL'},{id:'entry-2',marketEventId:'signal-2',decidedAt:dates[1]+'T03:45:00Z',state:'BUY_BLOCKED'}],manualExecution:null,fees:{buyBps:'0',sellBps:'0',slippageBps:'0',minimumFee:'0',sourceReference:'synthetic-zero-fees'},bias:'SURVIVORSHIP_BIASED_RESEARCH',limitations:[]};
}
test('metrics count neutral trades, use initial R, compound equity and draw down from the prior peak',()=>{
 const input=fixture(),result=paperPerformance(input);
 assert.equal(result.closedTrades,3);assert.equal(result.wins,1);assert.equal(result.losses,1);assert.equal(result.neutral,1);
 assert.equal(result.winRate,'0.333333');assert.equal(result.profitFactor,'2.000000');assert.equal(result.expectancyR,'0.166666');
 assert.equal(result.netRealizedPnl,'5.000000');assert.equal(result.netClosedPnl,'5.000000');
 assert.deepEqual(result.curve.map(row=>row.equity),['1010.000000','1005.000000','1005.000000']);
 assert.equal(result.curve.at(-1).compoundedReturn,'0.005000');assert.equal(result.maxDrawdown,'0.004950');
 assert.equal(result.blockedEntries,1);assert.equal(result.signalPaperExecutionGap,1);assert.equal(result.signalManualExecutionGap,null);
 assert.equal(result.performanceVerified,false);assert.equal(result.bias,input.bias);assert.deepEqual(result,paperPerformance(input));
 assert.equal(result.regimes.find(row=>row.regime==='RED').netClosedPnl,'-5.000000');assert.equal(result.regimes.find(row=>row.regime==='YELLOW').winRate,'0.000000');
 const linked=paperPerformance({...input,manualExecution:{matchedSignalIds:['signal-2'],asOf:input.asOf,sourceReference:'synthetic-manual-comparison'}});assert.equal(linked.signalManualExecutionGap,1);
 assert.equal(linked.comparison.sourceReference,'synthetic-manual-comparison');
 assert.notEqual(linked.id,paperPerformance({...input,manualExecution:{matchedSignalIds:['signal-1'],asOf:input.asOf,sourceReference:'synthetic-manual-comparison'}}).id);
 assert.throws(()=>paperPerformance({...input,manualExecution:{matchedSignalIds:['signal-1','signal-1'],asOf:input.asOf,sourceReference:'synthetic'}}),/INVALID_MANUAL_COMPARISON/);
});
test('future closes are excluded and missing valuations or costs stay explicit',()=>{
 const input=fixture(),prefix=paperPerformance({...input,asOf:input.days[0].asOf});
 assert.equal(prefix.closedTrades,1);assert.equal(prefix.profitFactor,null);assert.equal(prefix.expectancyR,'1.000000');assert.equal(prefix.curve.length,1);assert.equal(prefix.blockedEntries,0);
 const missing=paperPerformance({...input,days:[input.days[0],input.days[2]]});assert.equal(missing.maxDrawdown,null);assert.equal(missing.curve.at(-1).dailyReturn,null);assert.equal(missing.state,'INCOMPLETE');assert.ok(missing.limitations.includes('VALUATION_SESSION_MISSING:2026-10-21'));
 assert.equal(paperPerformance({...input,calendar:[]}).maxDrawdown,null);
 assert.equal(paperPerformance({...input,fees:null}).state,'COSTS_UNCONFIGURED');
 assert.equal(paperPerformance({...input,initialRisks:[]}).expectancyR,null);
 assert.equal(paperPerformance({...input,manualExecution:{matchedSignalIds:[],asOf:'2026-10-23T11:00:00Z',sourceReference:'future'}}).signalManualExecutionGap,null);
});
test('unpriced open holdings cannot become zero exposure or a complete equity curve',()=>{
 const input=fixture(),last=input.ledger.events.at(-1),ledgerInput={...input,asOf:last.occurredAt};
 // On the final day's open the last buy is visible, while its sell remains future evidence.
 ledgerInput.asOf='2026-10-22T04:30:00Z';ledgerInput.days=[...input.days.slice(0,2),{...input.days[2],asOf:ledgerInput.asOf}];
 const result=paperPerformance(ledgerInput),point=result.curve.at(-1);
 assert.equal(point.equity,null);assert.equal(point.grossExposure,null);assert.equal(result.maxDrawdown,null);assert.equal(result.openPositions.length,1);
 assert.ok(point.reasons.some(reason=>reason.startsWith('MARK_UNAVAILABLE')));
});
