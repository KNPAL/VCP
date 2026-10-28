import {backfillBinding,backfillContext,pendingBackfills,type PrismaClient,type BrokerKeyResolver} from '@vcp/database';
import type {Queue} from 'bullmq';
import {enqueueOnce,type Handler} from './runtime.js';
import {processBackfillWindow} from './backfill.js';
import {referencedBrokerBackfillGateway} from './historical-gateway.js';
export function backfillHandler(db:PrismaClient,q:Queue,loadKey:BrokerKeyResolver,now=()=>new Date().toISOString(),factory=referencedBrokerBackfillGateway):Handler{return async data=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!('runId' in data)||typeof data.runId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.runId))throw new Error('INVALID_BACKFILL_PAYLOAD');
 const binding=await backfillBinding(db,data.runId);if(!binding)throw new Error('BACKFILL_CONTEXT_UNAVAILABLE');
 return processBackfillWindow(db,data.runId,{now,fetch:async window=>{
  const {run,mapping}=await backfillContext(db,binding,now());
  const result=await factory(db,q,{reference:binding.credentialReference,loadKey,listingId:run.listingId,exchange:binding.exchange,symbolToken:binding.symbolToken,mapping,calendar:run.calendar,now,downloadAllowed:true}).fetch(window);
  // Permissions can be revoked while the provider request is in flight.
  await backfillContext(db,binding,now());
  return result;
 }});
}}
/** SQL remains authoritative: lost Redis jobs are rebuilt from uncommitted windows. */
export async function dispatchBackfills(db:PrismaClient,q:Queue){
 const pending=await pendingBackfills(db);let queued=0;
 for(const item of pending){
  const identity=item.id+'|'+item.attempts;
  let job=await enqueueOnce(q,'backfill',identity,{runId:item.runId});
  const state=await job.getState();
  // A completed duplicate may have observed another lease; SQL still says work is due.
  if(state==='completed'){await job.remove();job=await enqueueOnce(q,'backfill',identity,{runId:item.runId})}
  if(await job.getState()!=='failed')queued++;
 }return {queued};
}
