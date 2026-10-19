import {pendingCandleChanges,receiveCandleChange,recordCandleDispatch,type PrismaClient} from '@vcp/database';
import {enqueueOnce,type Handler} from './runtime.js';
import type {Queue} from 'bullmq';
export function candleChangeHandler(db:PrismaClient):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('eventId' in data)||typeof data.eventId!=='string')throw new Error('INVALID_CHANGE_PAYLOAD');
 return receiveCandleChange(db,data.eventId);
}}
/** Redis acknowledgement alone is not durable delivery; PostgreSQL receipt is the checkpoint. */
export async function dispatchCandleChanges(db:PrismaClient,q:Queue,limit=100,listingId:string|null=null){
 const events=await pendingCandleChanges(db,limit,listingId);let queued=0,failed=0;
 for(const event of events){
  try{
   const job=await enqueueOnce(q,'candle-change',event.id,{eventId:event.id});
   const state=await job.getState();
   await recordCandleDispatch(db,event.id,{jobId:job.id??null,state,attemptsMade:job.attemptsMade,reason:state==='failed'?'DELIVERY_ATTEMPTS_EXHAUSTED':null});
   if(state==='failed')failed++;else queued++;
  }catch{
   failed++;await recordCandleDispatch(db,event.id,{jobId:null,state:'UNAVAILABLE',attemptsMade:0,reason:'QUEUE_UNAVAILABLE'});
  }
 }
 return {queued,failed};
}
