import {assertActionPermissions,assertCandlePermissions} from './data-permissions.js';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {formatFixed,parseFixed,utcInstant} from '@vcp/domain';
import {benchmarkReadiness,verifiedCalendar,sourcePermission,type CalendarDay,type SourceRecord} from '@vcp/market-data';
import {currentSource} from './source-authority.js';

type Reader=Pick<PrismaClient,'$queryRaw'>;
type Bar={session:string;close:string;revision:string};
export function benchmarkSeriesDigest(bars:readonly Pick<Bar,'session'|'close'>[]){
 const closes=bars.map(bar=>[bar.session,formatFixed(parseFixed(bar.close))]);
 return createHash('sha256').update(JSON.stringify(closes)).digest('hex');
}
// The independent publisher's review binds the named index to this listing and every
// session close. A correct label, a valid candle grant or a matching row count alone
// cannot establish index identity.
export async function verifyBenchmarkIdentity(db:Reader,review:unknown,listingId:string,bars:readonly Bar[],asOf:string){
 if(!review||typeof review!=='object'||Array.isArray(review)||!bars.length)return false;
 const record=review as Record<string,unknown>,sourceId=record['sourceSnapshotId'];
 if(record['identifier']!=='NIFTY_500_PRICE'||record['listingId']!==listingId||typeof sourceId!=='string'||!/^[a-f0-9]{64}$/.test(sourceId)||typeof record['knownAt']!=='string')return false;
 try{
  if(utcInstant(record['knownAt'])>utcInstant(asOf)||record['seriesSha256']!==benchmarkSeriesDigest(bars))return false;
 }catch{return false}
 const [source]=await db.$queryRaw<{evidence:SourceRecord}[]>`SELECT evidence FROM "SourceSnapshot" WHERE id=${sourceId} AND dataset='BENCHMARK'`;
 if(!source)return false;
 const now=new Date().toISOString();
 for(const at of [asOf,now]){
  if((await currentSource(db,source.evidence,at))?.id!==sourceId||sourcePermission(source.evidence,'DERIVE',at).status!=='PASS'||sourcePermission(source.evidence,'STORE',at).status!=='PASS')return false;
 }
 const revisions=bars.map(bar=>bar.revision);
 const sessions=bars.map(bar=>bar.session);
 const [evidence]=await db.$queryRaw<{count:number;independent:boolean}[]>`SELECT count(*)::int AS count,
  bool_and(lower(trim(c.source))<>lower(trim(${source.evidence.provider})) AND c."listingId"=${listingId}::uuid
   AND c.session=input.session AND c."receivedAt"<=${utcInstant(asOf)}
   AND c."finalizedAt" IS NOT NULL AND c."finalizedAt"<=${utcInstant(asOf)}) AS independent
  FROM unnest(${revisions}::uuid[],${sessions}::date[]) AS input(id,session)
  JOIN "CandleRevision" c ON c.id=input.id`;
 return evidence?.count===bars.length&&evidence.independent===true;
}
export async function evaluateStoredBenchmark(db:Reader,details:unknown,asOf:string){
 const unavailable=(reason:string)=>({status:'UNKNOWN',reasons:[reason],riskMultiplier:'0'});
 if(!details||typeof details!=='object')return unavailable('BENCHMARK_PROOF_INCOMPLETE');
 const {adjustmentId,calendarId,identifier,identityReview}=details as Record<string,unknown>;
 if(identifier!=='NIFTY_500_PRICE'||typeof adjustmentId!=='string'||typeof calendarId!=='string'||![adjustmentId,calendarId].every(id=>/^[0-9a-f]{64}$/.test(id)))return unavailable('BENCHMARK_PROOF_INCOMPLETE');
 const [row]=await db.$queryRaw<{listingId:string;session:string;bars:(Bar&{rawRevisionId:string;finalizedAt:string;adjustmentVerified:boolean})[];calendar:CalendarDay[]}[]>`
  SELECT a."listingId",to_char(a."scaleSession",'YYYY-MM-DD') AS session,a.evidence->'result'->'bars' AS bars,c.evidence AS calendar
  FROM "AdjustmentSnapshot" a JOIN "CalendarSnapshot" c ON c.id=${calendarId}
  WHERE a.id=${adjustmentId} AND a.state='KNOWN' AND a."createdAt"<=${utcInstant(asOf)} AND a."asOf"<=${utcInstant(asOf)} AND c."createdAt"<=${utcInstant(asOf)}`;
 if(!row||!Array.isArray(row.bars)||row.bars.length<252||row.bars.at(-1)?.session!==row.session)return unavailable('BENCHMARK_HISTORY_INCOMPLETE');
 const bars=row.bars.map(bar=>({...bar,revision:bar.rawRevisionId,sourceRevision:bar.rawRevisionId}));
 let calendar;
 try{calendar=verifiedCalendar(row.calendar,bars[0]!.session,row.session,asOf)}catch{return unavailable('BENCHMARK_CALENDAR_INVALID')}
 if(calendar.state!=='KNOWN'||bars.some((b,i)=>!b.finalizedAt||Date.parse(b.finalizedAt)<Date.parse(calendar.sessions[i]?.finalizedAt??'')))return unavailable('BENCHMARK_FINALIZATION_UNVERIFIED');
 if(bars.some(bar=>typeof bar.revision!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bar.revision)))return unavailable('BENCHMARK_LINEAGE_MISSING');
 try{
  await assertActionPermissions(db,[adjustmentId],['DERIVE','STORE']);
  await assertCandlePermissions(db,bars.map(b=>b.revision),['DERIVE','STORE']);
 }catch(error){if(error instanceof Error&&['SOURCE_LINEAGE_MISSING','SOURCE_SCOPE_AMBIGUOUS','SOURCE_PERMISSION_REQUIRED'].includes(error.message))return unavailable(error.message);throw error}
 const identityVerified=await verifyBenchmarkIdentity(db,identityReview,row.listingId,bars,asOf);
 return benchmarkReadiness({identifier,identityVerified,calendarVerified:true,expectedSessions:calendar.sessions.map(day=>day.date),bars,asOf});
}
