import {claimSchedulerLease,scheduleCalendarTick,pendingScheduledScans,prepareScheduledScan,recordScheduledDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export function scheduledScanHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('scanId' in data)||typeof data.scanId!=='string')throw new Error('INVALID_SCHEDULED_SCAN_PAYLOAD');
 return prepareScheduledScan(db,data.scanId);
}}
export async function dispatchScheduledScans(db:PrismaClient,q:Queue){
 let queued=0;for(const {id} of await pendingScheduledScans(db)){
  let job=await enqueueOnce(q,'eod-prepare',id,{scanId:id});
  if(await job.getState()==='completed'){await job.remove();job=await enqueueOnce(q,'eod-prepare',id,{scanId:id})}
  const state=await job.getState();await recordScheduledDispatch(db,id,state);if(state!=='failed')queued++;
 }return {queued};
}
export async function runSchedulerCycle(db:PrismaClient,q:Queue,ownerId:string){
 const lease=await claimSchedulerLease(db,ownerId);
 if(!lease)return {state:'STANDBY',reason:'SCHEDULER_LEASE_HELD'};
 const result=await scheduleCalendarTick(db,lease);await dispatchScheduledScans(db,q);return result;
}
