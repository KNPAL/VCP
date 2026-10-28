import {PrismaClient,type Prisma} from '@prisma/client';
import type {MarketEvent,UserSignalDecision} from '@vcp/strategy';
import {utcInstant,sessionDate} from '@vcp/domain';
import {canonical} from './indicators.js';
import {appendMarketAlert} from './alerts.js';
export async function persistMarketEvent(db:PrismaClient,event:MarketEvent){
 return db.$transaction(tx=>persistMarketEventTransaction(tx,event));
}
/** A bounded research view; market confirmation never grants owner permission. */
export async function readMarketSignals(db:PrismaClient,type?:'BREAKOUT_CONFIRMED'|'BREAKOUT_PRICE_ONLY'){
 if(type!==undefined&&!['BREAKOUT_CONFIRMED','BREAKOUT_PRICE_ONLY'].includes(type))throw new Error('INVALID_SIGNAL_TYPE');
 const asOf=new Date().toISOString();
 const rows=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM (SELECT DISTINCT ON ("logicalId") "evidence","type","decidedAt","id" FROM "MarketEvent" WHERE "decidedAt"<=${new Date(asOf)} AND "observedAt"<=${new Date(asOf)} AND "occurredAt"<=${new Date(asOf)} ORDER BY "logicalId","decidedAt" DESC,"id" DESC) latest WHERE (${type??null}::text IS NULL OR "type"=${type??null}) ORDER BY "decidedAt" DESC,"id" DESC LIMIT 50`;
 return {asOf,validUntil:new Date(Date.parse(asOf)+30000).toISOString(),items:rows.map(row=>row.evidence),limit:50,executable:false};
}
async function persistMarketEventTransaction(db:Prisma.TransactionClient,event:MarketEvent){
 const json=canonical(event),occurredAt=utcInstant(event.occurredAt),observedAt=utcInstant(event.observedAt),decidedAt=utcInstant(event.decidedAt),session=new Date(sessionDate(event.session)+'T00:00:00Z');
 await db.$executeRaw`INSERT INTO "MarketEvent" ("id","logicalId","listingId","session","type","configHash","dataRevision","occurredAt","observedAt","decidedAt","evidence") VALUES (${event.id},${event.logicalId},${event.listingId}::uuid,${session},${event.type},${event.configHash},${event.dataRevision},${occurredAt},${observedAt},${decidedAt},${json}::jsonb) ON CONFLICT DO NOTHING`;
 const rows=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${event.id}`;
 if(canonical(rows[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: market event is immutable');await appendMarketAlert(db,event);return rows[0]!.evidence;
}
export async function persistUserDecision(db:PrismaClient,ownerId:string,decision:UserSignalDecision){
 const json=canonical(decision),decidedAt=utcInstant(decision.decidedAt),expiresAt=utcInstant(decision.expiresAt);
 const source=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${decision.marketEventId}`;
 if(!source[0]||canonical(source[0].evidence)!==canonical(decision.evidence.event))throw new Error('MARKET_EVENT_MISMATCH');
 await db.$executeRaw`INSERT INTO "UserSignalDecision" ("id","ownerId","marketEventId","state","decidedAt","expiresAt","evidence") VALUES (${decision.id},${ownerId}::uuid,${decision.marketEventId},${decision.state},${decidedAt},${expiresAt},${json}::jsonb) ON CONFLICT DO NOTHING`;
 const rows=await db.$queryRaw<{evidence:UserSignalDecision;ownerId:string}[]>`SELECT "evidence","ownerId" FROM "UserSignalDecision" WHERE "id"=${decision.id}`;
 if(rows[0]?.ownerId!==ownerId||canonical(rows[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: user decision is immutable');return rows[0]!.evidence;
}
