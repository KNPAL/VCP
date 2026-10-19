import {processEodScanItem,pendingEodScanItems,recordEodScanDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export function eodScanHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('itemId' in data)||typeof data.itemId!=='string'||!/^[0-9a-f]{64}$/.test(data.itemId))throw new Error('INVALID_EOD_SCAN_PAYLOAD');
 return processEodScanItem(db,data.itemId);
}}
export async function dispatchEodScans(db:PrismaClient,q:Queue){
 let queued=0;for(const {id} of await pendingEodScanItems(db)){
  let job=await enqueueOnce(q,'eod-scan',id,{itemId:id});
  if(await job.getState()==='completed'){await job.remove();job=await enqueueOnce(q,'eod-scan',id,{itemId:id})}
  const state=await job.getState();await recordEodScanDispatch(db,id,state);if(state!=='failed')queued++;
 }return {queued};
}
