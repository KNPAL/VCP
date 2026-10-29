import {PrismaClient,type Prisma} from '@prisma/client';
import type {MarketEvent,UserSignalDecision} from '@vcp/strategy';
import {utcInstant,sessionDate} from '@vcp/domain';
import {canonical} from './indicators.js';
import {appendMarketAlert} from './alerts.js';
import {assertCandlePermissions} from './data-permissions.js';
import type {DailyStructureResult} from './daily-structure.js';
export async function persistMarketEvent(db:PrismaClient,event:MarketEvent){
 return db.$transaction(tx=>persistMarketEventTransaction(tx,event));
}
export async function assertMarketSignalDisplay(db:PrismaClient,eventId:string){
 const events=await db.$queryRaw<{evidence:MarketEvent}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${eventId}`;
 const event=events[0]?.evidence;if(!event)throw new Error('MARKET_EVENT_UNAVAILABLE');
   const executions=await db.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "evidence"->'breakout'->'event'->>'id'=${event.id}`;
   const execution=executions[0]?.evidence;
   if(executions.length!==1||!execution?.previousId||!execution.input?.series?.bars?.length||canonical(execution.breakout.event)!==canonical(event))throw new Error('SOURCE_LINEAGE_MISSING');
   const previous=await db.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "id"=${execution.previousId}`;
   const prior=previous[0]?.evidence;
   if(!prior?.input?.series?.bars?.length||prior.input.listingId!==event.listingId||execution.input.listingId!==event.listingId||prior.input.series.bars.at(-1)!.session!==event.previousSnapshot.session||prior.input.series.dataRevision!==event.previousSnapshot.dataRevision)throw new Error('SOURCE_LINEAGE_MISSING');
   await assertCandlePermissions(db,[...event.sourceRevisions,...execution.input.series.bars.map(bar=>bar.revision),...prior.input.series.bars.map(bar=>bar.revision)],['DISPLAY','DERIVE']);
}
/** Display only signals whose original candle and frozen-pattern lineage is authorized now. */
export async function readDisplayMarketSignals(db:PrismaClient,type?:'BREAKOUT_CONFIRMED'|'BREAKOUT_PRICE_ONLY'){
 const result=await readMarketSignals(db,type),items:MarketEvent[]=[],unavailable:{id:string;reason:string}[]=[];
 for(const event of result.items){
  try{
   await assertMarketSignalDisplay(db,event.id);
   items.push(event);
  }catch(error){
   if(!(error instanceof Error)||!['SOURCE_LINEAGE_MISSING','SOURCE_PERMISSION_REQUIRED','SOURCE_SCOPE_AMBIGUOUS'].includes(error.message))throw error;
   unavailable.push({id:event.id,reason:error.message});
  }
 }
 return {...result,items,unavailable,state:unavailable.length?(items.length?'PARTIAL':'BLOCKED_DATA'):'KNOWN'};
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
