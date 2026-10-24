import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperLedger,appendPaperFill,paperPerformance,compareWalkForward} from '../packages/backtest/dist/index.js';
function run(candidate,phase,date,pnl){
 const runId=candidate+'-'+phase,open=date+'T03:45:00Z',close=date+'T10:30:00Z';let ledger=createPaperLedger(runId,'1000',open);
 const fill=(side,price,time)=>{ledger=appendPaperFill(ledger,{id:side,sourceDecisionId:side,expectedLedgerRevision:ledger.revision,isin:'INE000000001',side,quantity:1,price,fees:'0',modeledAt:time,decidedAt:time,simulated:true,executable:false})};
 fill('BUY','100',open);const episodeId=ledger.events.at(-1).id;fill('SELL',String(100+pnl),close);
 const report=paperPerformance({ledger,asOf:close,calendar:[{date,kind:'TRADING',opensAt:open,closesAt:date+'T10:00:00Z',finalizedAt:close,knownAt:'2026-10-01T00:00:00Z',source:'synthetic',verified:true}],days:[{session:date,asOf:close,marks:[],regime:{state:'GREEN',knownAt:open,revision:'regime'}}],initialRisks:[{episodeId,riskAmount:'10',knownAt:open,regime:'GREEN'}],signals:[],entryDecisions:[],manualExecution:null,fees:{buyBps:'0',sellBps:'0',slippageBps:'0',minimumFee:'0',sourceReference:'synthetic'},bias:null,limitations:[]});
 return {runId,window:{from:date,through:date},strategyRevision:candidate,dataRevision:phase,report};
}
const candidate=(id,trainPnl,testPnl)=>({id,train:run(id,'train','2026-10-20',trainPnl),validation:run(id,'validation','2026-10-21',0),outOfSample:run(id,'test','2026-10-22',testPnl)});
test('walk-forward selection is frozen on training evidence even when the rejected candidate wins out of sample',()=>{
 const fold={id:'fold-1',candidates:[candidate('a',10,80),candidate('b',20,-50)]},before=structuredClone(fold),result=compareWalkForward([fold]);
 assert.equal(result.folds[0].selectedCandidateId,'b');assert.equal(result.folds[0].outOfSample.netClosedPnl,'-50.000000');assert.equal(result.selectionUsesOutOfSample,false);
 assert.deepEqual(fold,before);assert.deepEqual(result,compareWalkForward([structuredClone(fold)]));
 const changed={...fold,candidates:[candidate('a',10,-50),candidate('b',20,80)]};assert.equal(compareWalkForward([changed]).folds[0].selectedCandidateId,'b');
 const tie={id:'ties',candidates:[candidate('b',10,80),candidate('a',10,-50)]};assert.equal(compareWalkForward([tie]).folds[0].selectedCandidateId,'a');
});
test('overlap, strategy retuning, changed data/costs and absent training evidence cannot become a valid comparison',()=>{
 const base={id:'fold',candidates:[candidate('a',10,5),candidate('b',20,5)]};
 for(const change of [f=>f.candidates[0].validation.window.from='2026-10-20',f=>f.candidates[0].outOfSample.strategyRevision='retuned',f=>f.candidates[1].train.dataRevision='different',f=>f.candidates[1].train.report.costs.minimumFee='1',f=>f.candidates[0].outOfSample.runId=f.candidates[0].train.runId]){const fold=structuredClone(base);change(fold);assert.throws(()=>compareWalkForward([fold]))}
 assert.throws(()=>compareWalkForward([base,{...base,id:'second'}]),/TEST_OVERLAP/);
 const noTraining=structuredClone(base);for(const row of noTraining.candidates){row.train.report.costs=null;row.train.report.state='COSTS_UNCONFIGURED'}
 const result=compareWalkForward([noTraining]);assert.equal(result.folds[0].state,'INSUFFICIENT_TRAINING_EVIDENCE');assert.equal(result.folds[0].selectedCandidateId,null);
});
