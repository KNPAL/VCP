import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {dailyBreakout,detectDailyStructure,ST_VCP_4_0,configurationHash,type DailyStructureInput,type FrozenDailyStructure} from '@vcp/strategy';
import {sessionDate,utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';

export interface DailyStructureResult {id:string;input:DailyStructureInput;previousId:string|null;breakout:ReturnType<typeof dailyBreakout>;detector:ReturnType<typeof detectDailyStructure>}
export async function getDailyStructure(db:PrismaClient,id:string){
 if(!/^[0-9a-f]{64}$/.test(id))throw new Error('INVALID_DAILY_EXECUTION_ID');
 const rows=await db.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "id"=${id}`;
 return rows[0]?.evidence??null;
}
/** Internal scanner boundary; never accepts client-supplied READY or primary state. */
export async function processDailyStructure(db:PrismaClient,input:DailyStructureInput):Promise<DailyStructureResult>{
 input=structuredClone(input);
 const session=sessionDate(input.series.sessions.at(-1)??''),decidedAt=utcInstant(input.decidedAt);
 if(decidedAt>new Date())throw new Error('DAILY_FUTURE_DECISION');
 const id=createHash('sha256').update(canonical(input)).digest('hex');
 return db.$transaction(async tx=>{
  // Serialize daily results for one listing, including concurrent duplicate deliveries.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.listingId},0))::text`;
  const existing=await tx.$queryRaw<{evidence:DailyStructureResult}[]>`SELECT "evidence" FROM "DailyStructureExecution" WHERE "listingId"=${input.listingId}::uuid AND "session"=${new Date(session)}`;
  if(existing[0]){if(existing[0].evidence.id!==id)throw new Error('DAILY_SESSION_ALREADY_FROZEN');return existing[0].evidence}
  const profile=await tx.strategyProfile.findUnique({where:{id:input.configHash}});
  if(!profile||profile.createdAt>decidedAt||configurationHash(profile.configuration)!==configurationHash(ST_VCP_4_0))throw new Error('DAILY_PROFILE_UNAVAILABLE');
  const previousSession=input.series.sessions.at(-2);
  const rows=previousSession?await tx.$queryRaw<{id:string;evidence:{detector:{frozen:FrozenDailyStructure}}}[]>`SELECT "id","evidence" FROM "DailyStructureExecution" WHERE "listingId"=${input.listingId}::uuid AND "session"=${new Date(sessionDate(previousSession))}`:[];
  const breakout=dailyBreakout(input,rows[0]?.evidence.detector.frozen??null);
  if(breakout.event){
   const e=breakout.event;
   await tx.$executeRaw`INSERT INTO "MarketEvent" ("id","logicalId","listingId","session","type","configHash","dataRevision","occurredAt","observedAt","decidedAt","evidence") VALUES (${e.id},${e.logicalId},${e.listingId}::uuid,${new Date(session)},${e.type},${e.configHash},${e.dataRevision},${utcInstant(e.occurredAt)},${utcInstant(e.observedAt)},${decidedAt},${canonical(e)}::jsonb) ON CONFLICT ("id") DO NOTHING`;
   const stored=await tx.$queryRaw<{evidence:unknown}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "id"=${e.id}`;
   if(canonical(stored[0]?.evidence)!==canonical(e))throw new Error('DAILY_EVENT_CONFLICT');
  }
  // Deliberately after the frozen-state check and event INSERT. Failure rolls both back.
  const detector=detectDailyStructure(input);
  for(const p of detector.structure.patterns){
   const data={patternId:p.id,listingId:input.listingId,session:new Date(session),dataRevision:input.series.dataRevision,adjustmentRevision:input.adjustmentRevision,asOf:utcInstant(input.series.asOf),decidedAt,evidence:JSON.parse(canonical(p))};
   const prior=await tx.patternSnapshot.findUnique({where:{patternId_session_dataRevision:{patternId:p.id,session:data.session,dataRevision:data.dataRevision}}});
   if(prior){if(canonical(prior.evidence)!==canonical(p))throw new Error('DAILY_PATTERN_CONFLICT')}else await tx.patternSnapshot.create({data});
  }
  const result:DailyStructureResult={id,input,previousId:rows[0]?.id??null,breakout,detector};
  await tx.$executeRaw`INSERT INTO "DailyStructureExecution" ("id","listingId","session","configHash","evidence") VALUES (${id},${input.listingId}::uuid,${new Date(session)},${input.configHash},${canonical(result)}::jsonb)`;
  return result;
 },{timeout:30000});
}
