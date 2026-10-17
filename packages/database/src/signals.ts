import {PrismaClient} from '@prisma/client';
import type {MarketEvent,UserSignalDecision} from '@vcp/strategy';
import {utcInstant,sessionDate} from '@vcp/domain';
import {canonical} from './indicators.js';
export async function persistMarketEvent(db:PrismaClient,event:MarketEvent){
 const json=canonical(event),occurredAt=utcInstant(event.occurredAt),observedAt=utcInstant(event.observedAt),decidedAt=utcInstant(event.decidedAt),session=new Date(sessionDate(event.session)+'T00:00:00Z');
 await db.$executeRaw`INSERT INTO "MarketEvent" ("id","logicalId","listingId","session","type","configHash","dataRevision","occurredAt","observedAt","decidedAt","evidence") VALUES (${event.id},${event.logicalId},${event.listingId}::uuid,${session},${event.type},${event.configHash},${event.dataRevision},${occurredAt},${observedAt},${decidedAt},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 const rows=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${event.id}`;
 if(canonical(rows[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: market event is immutable');return rows[0]!.evidence;
}
export async function persistUserDecision(db:PrismaClient,ownerId:string,decision:UserSignalDecision){
 const json=canonical(decision),decidedAt=utcInstant(decision.decidedAt),expiresAt=utcInstant(decision.expiresAt);
 const source=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${decision.marketEventId}`;
 if(!source[0]||canonical(source[0].evidence)!==canonical(decision.evidence.event))throw new Error('MARKET_EVENT_MISMATCH');
 await db.$executeRaw`INSERT INTO "UserSignalDecision" ("id","ownerId","marketEventId","state","decidedAt","expiresAt","evidence") VALUES (${decision.id},${ownerId}::uuid,${decision.marketEventId},${decision.state},${decidedAt},${expiresAt},${json}::jsonb) ON CONFLICT ("id") DO NOTHING`;
 const rows=await db.$queryRaw<{evidence:UserSignalDecision;ownerId:string}[]>`SELECT "evidence","ownerId" FROM "UserSignalDecision" WHERE "id"=${decision.id}`;
 if(rows[0]?.ownerId!==ownerId||canonical(rows[0]?.evidence)!==json)throw new Error('STALE_CONFLICT: user decision is immutable');return rows[0]!.evidence;
}
