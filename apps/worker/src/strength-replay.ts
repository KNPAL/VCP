import {prepareStrengthReplayPlans,discoverPendingReplayContexts,refreshReplayDependencies,pendingStrengthReplayPlans,executeStrengthReplayPlan,recordStrengthReplayDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export async function dispatchStrengthReplays(db:PrismaClient,q:Queue){
 await prepareStrengthReplayPlans(db);await discoverPendingReplayContexts(db);await refreshReplayDependencies(db);let queued=0;
 for(const {id} of await pendingStrengthReplayPlans(db)){
  let job=await enqueueOnce(q,'strength-replay',id,{planId:id});
  if(await job.getState()==='completed'){await job.remove();job=await enqueueOnce(q,'strength-replay',id,{planId:id})}
  const state=await job.getState();await recordStrengthReplayDispatch(db,id,state);if(state!=='failed')queued++;
 }
 return {queued};
}
export function strengthReplayHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('planId' in data)||typeof data.planId!=='string')throw new Error('INVALID_STRENGTH_REPLAY_PAYLOAD');
 return executeStrengthReplayPlan(db,data.planId);
}}
