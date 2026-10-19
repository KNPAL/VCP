import {replayStoredStructure,pendingStructureReplays,recordStructureDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export function structureReplayHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('INVALID_STRUCTURE_REPLAY_PAYLOAD');
 const row=data as Record<string,unknown>;
 if(Object.keys(row).some(k=>!['indicatorReceiptId','instrumentSnapshotId','profileId','strengthReplayId'].includes(k))||typeof row['indicatorReceiptId']!=='string'||typeof row['instrumentSnapshotId']!=='string'||typeof row['profileId']!=='string'||('strengthReplayId' in row&&typeof row['strengthReplayId']!=='string'))throw new Error('INVALID_STRUCTURE_REPLAY_PAYLOAD');
 return replayStoredStructure(db,{indicatorReceiptId:row['indicatorReceiptId'],instrumentSnapshotId:row['instrumentSnapshotId'],profileId:row['profileId'],...(typeof row['strengthReplayId']==='string'?{strengthReplayId:row['strengthReplayId']}:{})});
}}
export async function dispatchStructureReplays(db:PrismaClient,q:Queue){
 let queued=0;for(const input of await pendingStructureReplays(db)){
  let job=await enqueueOnce(q,'structure-replay',input.strengthReplayId,input);
  if(await job.getState()==='completed'){await job.remove();job=await enqueueOnce(q,'structure-replay',input.strengthReplayId,input)}
  const state=await job.getState();await recordStructureDispatch(db,input.strengthReplayId,state);if(state!=='failed')queued++;
 }return {queued};
}
