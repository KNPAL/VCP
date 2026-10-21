import {createHash,randomUUID} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import type {MarketEvent} from '@vcp/strategy';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
export type AlertChannel='IN_APP'|'EMAIL'|'BROWSER';
export interface AlertEvidence {id:string;sourceEventId:string;kind:string;sourceAt:string;occurredAt:string;decidedAt:string;effectiveAt:string;strategyVersion:string;configHash:string;dataRevision:string;executable:false}
const digest=(input:unknown)=>createHash('sha256').update(canonical(input)).digest('hex');
export function validateAlert(event:AlertEvidence){
 if(!/^[a-f0-9]{64}$/.test(event.id)||!/^[a-f0-9]{64}$/.test(event.sourceEventId)||!/^[a-f0-9]{64}$/.test(event.configHash)||!['BREAKOUT_CONFIRMED','BREAKOUT_PRICE_ONLY','WATCH','READY','DEVELOPING','BLOCKED_DATA','REJECTED','EXPIRED','INVALIDATED','SELL','MONITOR_DEGRADED','PARTIAL_PROFIT'].includes(event.kind)||!event.strategyVersion||!event.dataRevision||event.executable!==false)throw new Error('INVALID_ALERT_EVIDENCE');
 const source=utcInstant(event.sourceAt),occurred=utcInstant(event.occurredAt),decided=utcInstant(event.decidedAt),effective=utcInstant(event.effectiveAt);
 if(occurred>source||source>decided||decided>effective||decided>new Date())throw new Error('INVALID_ALERT_CHRONOLOGY');
}
/** Caller must commit the source event in this SAME transaction. No public event-write API. */
export async function appendAlert(tx:Prisma.TransactionClient,event:AlertEvidence,ownerIds:readonly string[],channels:readonly AlertChannel[]=['IN_APP']){
 validateAlert(event);if(channels.some(c=>!['IN_APP','EMAIL','BROWSER'].includes(c)))throw new Error('INVALID_ALERT_CHANNEL');
 const json=canonical(event);await tx.$executeRaw`INSERT INTO "AlertEvent" ("id","evidence") VALUES (${event.id},${json}::jsonb) ON CONFLICT DO NOTHING`;
 const existing=await tx.$queryRaw<{evidence:AlertEvidence}[]>`SELECT "evidence" FROM "AlertEvent" WHERE "id"=${event.id}`;
 if(canonical(existing[0]?.evidence)!==json)throw new Error('IMMUTABLE_ALERT_CONFLICT');
 for(const ownerId of new Set(ownerIds))for(const channel of new Set(channels)){
  const id=digest([ownerId,event.id,channel,event.strategyVersion]);
  await tx.$executeRaw`INSERT INTO "NotificationOutbox" ("id","ownerId","eventId","channel","ruleVersion") VALUES (${id},${ownerId}::uuid,${event.id},${channel},${event.strategyVersion}) ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`INSERT INTO "NotificationDelivery" ("outboxId") VALUES (${id}) ON CONFLICT DO NOTHING`;
 }
 return event;
}
export async function appendMarketAlert(tx:Prisma.TransactionClient,event:MarketEvent){
 const owners=await tx.owner.findMany({select:{id:true}});
 return appendAlert(tx,{id:event.id,sourceEventId:event.id,kind:event.type,sourceAt:event.observedAt,occurredAt:event.occurredAt,decidedAt:event.decidedAt,effectiveAt:event.effectiveAt,strategyVersion:event.strategyVersion,configHash:event.configHash,dataRevision:event.dataRevision,executable:false},owners.map(o=>o.id));
}
export interface AlertDelivery {id:string;ownerId:string;eventId:string;channel:AlertChannel;event:AlertEvidence;token:string;attempt:number}
export async function claimAlert(db:PrismaClient,leaseMs=30000,outboxId?:string):Promise<AlertDelivery|null>{
 if(!Number.isInteger(leaseMs)||leaseMs<50||leaseMs>60000)throw new Error('INVALID_ALERT_LEASE');
 if(outboxId!==undefined&&!/^[a-f0-9]{64}$/.test(outboxId))throw new Error('INVALID_OUTBOX_ID');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`UPDATE "NotificationDelivery" SET "state"='FAILED',"reason"='ATTEMPTS_EXHAUSTED',"updatedAt"=clock_timestamp() WHERE "attempts">=4 AND "state"='DELIVERING' AND "leaseUntil"<=clock_timestamp()`;
  const rows=await tx.$queryRaw<{id:string;ownerId:string;eventId:string;channel:AlertChannel;event:AlertEvidence;attempts:number}[]>`SELECT o."id",o."ownerId",o."eventId",o."channel",e."evidence" AS "event",d."attempts" FROM "NotificationDelivery" d JOIN "NotificationOutbox" o ON o."id"=d."outboxId" JOIN "AlertEvent" e ON e."id"=o."eventId" WHERE (${outboxId??null}::text IS NULL OR o."id"=${outboxId??null}) AND d."attempts"<4 AND ((d."state"='PENDING' AND d."nextAttemptAt"<=clock_timestamp()) OR (d."state"='DELIVERING' AND d."leaseUntil"<=clock_timestamp())) ORDER BY CASE WHEN e."evidence"->>'kind'='SELL' THEN 0 WHEN e."evidence"->>'kind'='MONITOR_DEGRADED' THEN 1 ELSE 2 END,d."nextAttemptAt",o."id" FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
  const row=rows[0];if(!row)return null;const token=randomUUID(),attempt=row.attempts+1;
  await tx.$executeRaw`UPDATE "NotificationDelivery" SET "state"='DELIVERING',"attempts"=${attempt},"leaseToken"=${token}::uuid,"leaseUntil"=clock_timestamp()+${leaseMs}*interval '1 millisecond',"updatedAt"=clock_timestamp() WHERE "outboxId"=${row.id}`;
  await tx.$executeRaw`INSERT INTO "NotificationAttempt" ("id","outboxId","attempt","stage") VALUES (${randomUUID()}::uuid,${row.id},${attempt},'STARTED')`;
  return {...row,token,attempt};
 });
}
export async function finishAlert(db:PrismaClient,claim:AlertDelivery,delivered:boolean){
 return db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<{attempts:number}[]>`SELECT "attempts" FROM "NotificationDelivery" WHERE "outboxId"=${claim.id} AND "leaseToken"=${claim.token}::uuid AND "state"='DELIVERING' AND "leaseUntil">clock_timestamp() FOR UPDATE`;
  if(!rows[0])return false;
  const attempt=rows[0].attempts,state=delivered?'DELIVERED':attempt>=4?'FAILED':'PENDING',reason=delivered?null:'ADAPTER_UNAVAILABLE',delay=1000*2**(attempt-1);
  const updated=await tx.$executeRaw`UPDATE "NotificationDelivery" SET "state"=${state},"reason"=${reason},"leaseToken"=NULL,"leaseUntil"=NULL,"nextAttemptAt"=clock_timestamp()+${delay}*interval '1 millisecond',"updatedAt"=clock_timestamp() WHERE "outboxId"=${claim.id} AND "leaseToken"=${claim.token}::uuid AND "leaseUntil">clock_timestamp()`;
  if(!updated)return false;
  await tx.$executeRaw`INSERT INTO "NotificationAttempt" ("id","outboxId","attempt","stage","reason") VALUES (${randomUUID()}::uuid,${claim.id},${attempt},${delivered?'DELIVERED':'FAILED'},${reason})`;return true;
 });
}
export async function deliverAlert(db:PrismaClient,adapter?:(delivery:AlertDelivery)=>Promise<void>,outboxId?:string){
 const claim=await claimAlert(db,30000,outboxId);if(!claim)return {state:'IDLE' as const};let delivered=false;
 try{
  if(adapter)await adapter(claim);
  else if(claim.channel==='IN_APP')await db.$executeRaw`INSERT INTO "InboxNotification" ("id","ownerId","eventId") VALUES (${claim.id},${claim.ownerId}::uuid,${claim.eventId}) ON CONFLICT DO NOTHING`;
  else throw new Error('ADAPTER_UNAVAILABLE');
  delivered=true;
 }catch{/* External error bodies are never persisted or logged. */}
 const accepted=await finishAlert(db,claim,delivered);return {state:accepted?(delivered?'DELIVERED':'RETRY_OR_FAILED'):'LEASE_LOST',id:claim.id};
}


