import type {Prisma} from '@prisma/client';
import {exchangeDate,utcInstant} from '@vcp/domain';
import {verifiedCalendar,readiness,universeAt,canonicalListings,type InstrumentSnapshot,type CalendarDay,type GateProof,type UniverseSnapshot} from '@vcp/market-data';
import {marketRegime} from '@vcp/indicators';
import {canonical} from './indicators.js';
import type {Plan} from './eod-scan.js';

/** Server-only authority: never fall back to an older passing plan or proof. */
export async function readCurrentRegime(tx:Prisma.TransactionClient,asOf:string){
 const at=utcInstant(asOf),today=exchangeDate(asOf);
 const plans=await tx.$queryRaw<{id:string;evidence:Plan}[]>`SELECT "id","evidence" FROM "EodScanPlan" WHERE "createdAt"<=${at} AND "evidence"->'request'->>'asOf'<=${asOf} ORDER BY "evidence"->'request'->>'session' DESC,"evidence"->'request'->>'asOf' DESC,"createdAt" DESC,"id" LIMIT 1`;
 const plan=plans[0]?.evidence,source=plan?.regime;
 const unknown=(reason:string)=>({regime:'UNKNOWN' as const,reasons:[reason],scanId:plans[0]?.id??null,revision:plan?.dataRevision??null,asOf,validUntil:asOf,evidence:source??null});
 if(!plan||!source)return unknown('REGIME_EVIDENCE_REQUIRED');
 if(source.session>today||source.asOf!==plan.request.asOf||source.calendarId!==plan.request.calendarId)return unknown('REGIME_INVALID_EVIDENCE');
 const calendars=await tx.$queryRaw<{id:string;evidence:CalendarDay[]}[]>`SELECT "id","evidence" FROM "CalendarSnapshot" WHERE "createdAt"<=${at} ORDER BY "createdAt" DESC,"id" LIMIT 1`;
 const calendar=calendars[0];
 // Any calendar revision requires a fresh EOD plan, including corrections to historical bars.
 if(calendar?.id!==source.calendarId)return unknown('REGIME_CALENDAR_CHANGED');
 let days:CalendarDay[];
 try{
  const verified=verifiedCalendar(calendar.evidence,source.session,today,asOf);
  if(verified.state!=='KNOWN'||verified.sessions.at(-1)?.date!==source.session)return unknown('REGIME_SESSION_STALE');
  days=calendar.evidence.filter(d=>d.date>=source.session&&d.date<=today);
  if(days.some(d=>d.kind!=='HOLIDAY'&&d.closesAt&&utcInstant(d.closesAt)<=at&&(!d.finalizedAt||utcInstant(d.finalizedAt)>at)))return unknown('REGIME_SESSION_NOT_FINAL');
 }catch{return unknown('REGIME_CALENDAR_UNAVAILABLE')}
 const proofs=await tx.$queryRaw<{id:string;evidence:GateProof}[]>`SELECT "id","evidence" FROM "ReadinessProof" WHERE "gate"='G04' AND "probeAt"<=${at} ORDER BY "probeAt" DESC,"id" LIMIT 1`;
 const proof=proofs[0],details=proof?.evidence.details as {identifier?:string;adjustmentId?:string}|undefined;
 if(!proof||readiness([proof.evidence],asOf).items.find(g=>g.gate==='G04')?.status!=='PASS'||details?.identifier!=='NIFTY_500_PRICE'||details.adjustmentId!==source.benchmark.adjustmentId)return unknown('REGIME_BENCHMARK_UNAVAILABLE');
 const universes=await tx.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`;
 const universe=universeAt(universes.map(r=>r.evidence),asOf);
 if(universe.state!=='KNOWN'||universe.snapshotId!==plan.universe.universe.snapshotId)return unknown('REGIME_UNIVERSE_CHANGED');
 const mappings=await tx.$queryRaw<{id:string;evidence:InstrumentSnapshot}[]>`SELECT "id","evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 if(plan.universe.listings.some(r=>r.snapshotId!==mappings[0]?.id))return unknown('REGIME_MAPPING_CHANGED');
 const listings=canonicalListings(mappings.map(r=>r.evidence),source.intended,asOf);
 if(listings.some(r=>r.primary?.listingId!==plan.universe.listings.find(p=>p.isin===r.isin)?.primary?.listingId))return unknown('REGIME_MAPPING_CHANGED');
 const profiles=await tx.$queryRaw<{profileId:string}[]>`SELECT "profileId" FROM "StrategyActivation" WHERE "activatedAt"<=${at} AND "knownAt"<=${at} ORDER BY "activatedAt" DESC,"knownAt" DESC,"id" DESC LIMIT 1`;
 if(profiles[0]?.profileId!==plan.configHash)return unknown('REGIME_PROFILE_CHANGED');
 const ids=[source.benchmark.adjustmentId,...source.members.map(m=>m.adjustmentId)].filter((id):id is string=>id!==null);
 // One query validates all pinned revisions, including newer negative adjustments and raw corrections.
 const changed=await tx.$queryRaw<{id:string}[]>`SELECT a."id" FROM "AdjustmentSnapshot" a WHERE a."id"=ANY(${ids}::text[]) AND (
 a."id" IS DISTINCT FROM (SELECT n."id" FROM "AdjustmentSnapshot" n WHERE n."listingId"=a."listingId" AND n."asOf"<=${at} AND n."createdAt"<=${at} ORDER BY n."asOf" DESC,n."createdAt" DESC,n."id" LIMIT 1)
 OR EXISTS (SELECT 1 FROM "AdjustedDailyCandle" b JOIN "CandleRevision" r ON r."id"=b."rawRevisionId"
 LEFT JOIN "RawDailyCandle" c ON c."listingId"=r."listingId" AND c."session"=r."session" AND c."provider"=r."source"
 WHERE b."adjustmentId"=a."id" AND c."revisionId" IS DISTINCT FROM b."rawRevisionId"))`;
 if(changed.length)return unknown('REGIME_SOURCE_SUPERSEDED');
 const result=marketRegime(source.benchmark.close,source.benchmark.sma50,source.benchmark.sma200,source.intended,source.members);
 if(canonical(result)!==canonical(source.result)||!['GREEN','YELLOW','RED'].includes(result.regime))return unknown('REGIME_INPUTS_UNKNOWN');
 // Do not let a plan survive midnight, the next close, or benchmark proof expiry.
 const midnight=Date.parse(today+'T18:30:00Z');
 const validUntil=new Date(Math.min(at.valueOf()+30000,midnight,Date.parse(proof.evidence.expiresAt),...days.filter(d=>d.closesAt&&Date.parse(d.closesAt)>at.valueOf()).map(d=>Date.parse(d.closesAt!)))).toISOString();
 return {regime:result.regime as 'GREEN'|'YELLOW'|'RED',reasons:[] as string[],scanId:plans[0]!.id,revision:plan.dataRevision,benchmarkProofId:proof.id,asOf,validUntil,evidence:source};
}
