import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import type {Pattern} from '@vcp/vcp';
import {utcInstant,sessionDate,exchangeDate} from '@vcp/domain';
import {canonical} from './indicators.js';
import {appendAlert} from './alerts.js';
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function lifecycleState(pattern:Pattern){
 if(pattern.state==='WATCH_DATA')return 'BLOCKED_DATA';
 if(!['DEVELOPING','WATCH','READY','REJECTED','EXPIRED','INVALIDATED'].includes(pattern.state))throw new Error('UNKNOWN_PATTERN_STATE');
 return pattern.state;
}
/** Internal live-detector boundary. Correction replay never calls this function. */
export async function observePattern(tx:Prisma.TransactionClient,pattern:Pattern,session:string,configHash:string){
 sessionDate(session);const asOf=utcInstant(pattern.asOf),decidedAt=utcInstant(pattern.decidedAt),state=lifecycleState(pattern);
 if(!/^[a-f0-9]{64}$/.test(pattern.id)||!/^[a-f0-9]{64}$/.test(configHash)||asOf>decidedAt||decidedAt>new Date()||exchangeDate(asOf.toISOString())!==session)throw new Error('INVALID_LIFECYCLE_CONTEXT');
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pattern.id+'|'+configHash},0))::text`;
 const id=hash([pattern.id,session,configHash]),evidence={id,patternId:pattern.id,listingId:pattern.listingId,session,configHash,state,pattern};
 const existing=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PatternLifecycle" WHERE "id"=${id}`;
 if(existing[0]){if(canonical(existing[0].evidence)!==canonical(evidence))throw new Error('IMMUTABLE_LIFECYCLE_CONTEXT');return {id,changed:false}}
 const previous=await tx.$queryRaw<{id:string;state:string;session:Date;asOf:Date}[]>`SELECT "id","state","session","asOf" FROM "PatternLifecycle" WHERE "patternId"=${pattern.id} AND "configHash"=${configHash} ORDER BY "session" DESC LIMIT 1`;
 if(previous[0]&&(previous[0].session>=new Date(session)||previous[0].asOf>=asOf))throw new Error('LIFECYCLE_OUT_OF_ORDER');
 if(previous[0]?.state==='EXPIRED'&&state!=='EXPIRED'||previous[0]?.state==='INVALIDATED'&&!['INVALIDATED','EXPIRED'].includes(state))throw new Error('TERMINAL_PATTERN_STATE');
 await tx.$executeRaw`INSERT INTO "PatternLifecycle" ("id","patternId","listingId","session","configHash","state","asOf","evidence") VALUES (${id},${pattern.id},${pattern.listingId}::uuid,${new Date(session)},${configHash},${state},${asOf},${canonical(evidence)}::jsonb)`;
 const from=previous[0]?.state??'DISCOVERED';if(from===state)return {id,changed:false};
 const transitionId=hash([id,previous[0]?.id??null,from,state]),transition={id:transitionId,observationId:id,patternId:pattern.id,listingId:pattern.listingId,previousObservationId:previous[0]?.id??null,from,to:state,occurredAt:pattern.asOf,observedAt:pattern.decidedAt,decidedAt:pattern.decidedAt,effectiveAt:pattern.decidedAt,dataRevision:pattern.dataRevision,strategyVersion:pattern.strategyVersion,configHash,reasons:pattern.reasons,firstObservation:!previous[0]};
 await tx.$executeRaw`INSERT INTO "PatternTransition" ("id","observationId","patternId","evidence") VALUES (${transitionId},${id},${pattern.id},${canonical(transition)}::jsonb)`;
 const owners=await tx.owner.findMany({select:{id:true}});
 await appendAlert(tx,{id:transitionId,sourceEventId:transitionId,kind:state,sourceAt:pattern.asOf,occurredAt:pattern.asOf,decidedAt:pattern.decidedAt,effectiveAt:pattern.decidedAt,strategyVersion:pattern.strategyVersion,configHash,dataRevision:pattern.dataRevision,executable:false},owners.map(o=>o.id));
 return {id,changed:true,transitionId};
}
export async function patternHistory(db:PrismaClient,patternId:string){
 if(!/^[a-f0-9]{64}$/.test(patternId))throw new Error('INVALID_PATTERN_ID');
 const observations=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "PatternLifecycle" WHERE "patternId"=${patternId} ORDER BY "session","id"`;
 const transitions=await db.$queryRaw<{evidence:unknown}[]>`SELECT t."evidence" FROM "PatternTransition" t JOIN "PatternLifecycle" p ON p."id"=t."observationId" WHERE t."patternId"=${patternId} ORDER BY p."session",t."id"`;
 const breakouts=await db.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "evidence"->>'patternId'=${patternId} ORDER BY "occurredAt","id"`;
 return {patternId,observations:observations.map(r=>r.evidence),transitions:transitions.map(r=>r.evidence),breakouts:breakouts.map(r=>r.evidence),state:observations.length?'RECORDED':'UNKNOWN',reason:observations.length?null:'NO_LIFECYCLE_OBSERVATIONS'};
}
