import {replayStoredIndicators,pendingIndicatorReplays,recordIndicatorReplayDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export async function dispatchIndicatorReplays(db:PrismaClient,q:Queue){
 const pending=await pendingIndicatorReplays(db);let queued=0;
 for(const input of pending){
  const identity=[input.eventId,input.adjustmentId,input.calendarHash].join('|');
  let job=await enqueueOnce(q,'indicator-replay',identity,input);
  if(await job.getState()==='completed'){await job.remove();job=await enqueueOnce(q,'indicator-replay',identity,input)}
  const state=await job.getState();await recordIndicatorReplayDispatch(db,input,state);
  if(state!=='failed')queued++;
 }return {queued};
}
export function indicatorReplayHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('INVALID_REPLAY_PAYLOAD');
 const row=data as Record<string,unknown>;
 if(Object.keys(row).length!==3||typeof row['eventId']!=='string'||typeof row['adjustmentId']!=='string'||typeof row['calendarHash']!=='string')throw new Error('INVALID_REPLAY_PAYLOAD');
 return replayStoredIndicators(db,{eventId:row['eventId'],adjustmentId:row['adjustmentId'],calendarHash:row['calendarHash']});
}}
