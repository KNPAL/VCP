import {sessionDate,exchangeDate,parseFixed} from '@vcp/domain';
import {configurationHash} from '@vcp/strategy';
import type {paperPerformance} from './performance.js';
export interface WalkForwardRun {
 runId:string;window:{from:string;through:string};strategyRevision:string;dataRevision:string;
 report:ReturnType<typeof paperPerformance>;
}
export interface WalkForwardCandidate {id:string;train:WalkForwardRun;validation:WalkForwardRun;outOfSample:WalkForwardRun}
export interface WalkForwardFold {id:string;candidates:readonly WalkForwardCandidate[]}
/** Select on training R expectancy only; validation/OOS outcomes cannot influence selection. */
export function compareWalkForward(folds:readonly WalkForwardFold[]){
 if(!folds.length||new Set(folds.map(fold=>fold.id)).size!==folds.length)throw new Error('INVALID_WALK_FORWARD_FOLDS');
 let previousTestEnd:string|null=null;
 const results=folds.map(fold=>{
  if(!fold.id||!fold.candidates.length||new Set(fold.candidates.map(row=>row.id)).size!==fold.candidates.length)throw new Error('INVALID_WALK_FORWARD_CANDIDATES');
  const baseline=fold.candidates[0]!;
  for(const candidate of fold.candidates){
   if(!candidate.id)throw new Error('INVALID_WALK_FORWARD_CANDIDATE');
   const phases=[candidate.train,candidate.validation,candidate.outOfSample];
   if(new Set(phases.map(run=>run.runId)).size!==3)throw new Error('WALK_FORWARD_RUN_REUSED');
   for(const phase of ['train','validation','outOfSample'] as const){
    const run=candidate[phase],reference=baseline[phase];sessionDate(run.window.from);sessionDate(run.window.through);
    if(!run.runId||!run.strategyRevision||!run.dataRevision||run.window.from>run.window.through||exchangeDate(run.report.asOf)!==run.window.through)throw new Error('INVALID_WALK_FORWARD_WINDOW');
    if(configurationHash(run.window)!==configurationHash(reference.window)||run.dataRevision!==reference.dataRevision||configurationHash(run.report.costs)!==configurationHash(reference.report.costs))throw new Error('WALK_FORWARD_INCOMPARABLE_DATA_OR_COSTS');
    if(run.strategyRevision!==candidate.train.strategyRevision)throw new Error('WALK_FORWARD_CONFIGURATION_CHANGED');
    if(run.report.trades.some(trade=>exchangeDate(trade.openedAt)<run.window.from||exchangeDate(trade.closedAt!)>run.window.through))throw new Error('WALK_FORWARD_TRADE_OUTSIDE_WINDOW');
   }
   if(candidate.train.window.through>=candidate.validation.window.from||candidate.validation.window.through>=candidate.outOfSample.window.from)throw new Error('WALK_FORWARD_WINDOW_OVERLAP');
  }
  if(previousTestEnd&&previousTestEnd>=baseline.outOfSample.window.from)throw new Error('WALK_FORWARD_TEST_OVERLAP');
  previousTestEnd=baseline.outOfSample.window.through;
  const eligible=fold.candidates.filter(candidate=>candidate.train.report.state==='COMPUTED'&&candidate.train.report.costs!==null&&candidate.train.report.closedTrades>0&&candidate.train.report.expectancyR!==null);
  const ranked=[...eligible].sort((a,b)=>{const x=parseFixed(a.train.report.expectancyR!),y=parseFixed(b.train.report.expectancyR!);return x===y?a.id.localeCompare(b.id):x>y?-1:1});
  const selected=ranked[0]??null;
  const summarize=(run:WalkForwardRun)=>({runId:run.runId,reportId:run.report.id,window:run.window,state:run.report.state,closedTrades:run.report.closedTrades,expectancyR:run.report.expectancyR,netClosedPnl:run.report.netClosedPnl,maxDrawdown:run.report.maxDrawdown,bias:run.report.bias,limitations:run.report.limitations});
  return {id:fold.id,selectionRule:'TRAIN_EXPECTANCY_R_DESC_ID_ASC',selectionAsOf:baseline.train.report.asOf,selectedCandidateId:selected?.id??null,strategyRevision:selected?.train.strategyRevision??null,state:selected?'COMPARED':'INSUFFICIENT_TRAINING_EVIDENCE',trainingRanking:ranked.map(row=>({candidateId:row.id,...summarize(row.train)})),validation:selected?summarize(selected.validation):null,outOfSample:selected?summarize(selected.outOfSample):null,candidates:fold.candidates.map(candidate=>({id:candidate.id,train:summarize(candidate.train),validation:summarize(candidate.validation),outOfSample:summarize(candidate.outOfSample)}))};
 });
 const body={folds:results,selectionUsesOutOfSample:false,executable:false,performanceVerified:false};
 return {id:configurationHash(body),...body};
}
