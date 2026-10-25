import type {InstrumentMapping} from '@vcp/market-data';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ipoResearch,validateIpoListing,type IpoListingEvidence} from '@vcp/strategy';
import {utcInstant} from '@vcp/domain';
import {canonical} from './indicators.js';
import {loadSeries} from './eod-scan.js';
export async function persistIpoListing(db:PrismaClient,evidence:IpoListingEvidence){
 evidence=structuredClone(validateIpoListing(evidence));if(utcInstant(evidence.knownAt)>new Date())throw new Error('IPO_FUTURE_SOURCE');
 if(evidence.verified){const mappings=await db.$queryRaw<{evidence:InstrumentMapping}[]>`SELECT m."evidence" FROM "ListingMapping" m JOIN "InstrumentSnapshot" s ON s."id"=m."snapshotId" WHERE m."listingId"=${evidence.listingId}::uuid AND s."knownAt"<=${utcInstant(evidence.knownAt)} ORDER BY s."knownAt" DESC,s."id",m."id" LIMIT 1`;const mapping=mappings[0]?.evidence;if(!mapping?.verified||mapping.isin!==evidence.isin||mapping.listingDate!==evidence.listingDate||mapping.instrumentType!=='EQUITY')throw new Error('IPO_VERIFIED_LISTING_MISMATCH')}
 const encoded=canonical(evidence),id=createHash('sha256').update(encoded).digest('hex');
 await db.$executeRaw`INSERT INTO "IpoListingSnapshot" ("id","listingId","knownAt","evidence") VALUES (${id},${evidence.listingId}::uuid,${utcInstant(evidence.knownAt)},${encoded}::jsonb) ON CONFLICT DO NOTHING`;
 return {id,executable:false};
}
export async function listIpoResearch(db:PrismaClient){
 const rows=await db.$queryRaw<{id:string;evidence:IpoListingEvidence}[]>`SELECT DISTINCT ON ("listingId") "id","evidence" FROM "IpoListingSnapshot" WHERE "knownAt"<=clock_timestamp() AND "recordedAt"<=clock_timestamp() ORDER BY "listingId","knownAt" DESC,"recordedAt" DESC,"id"`;
 return {items:rows.map(row=>({id:row.id,listingId:row.evidence.listingId,isin:row.evidence.isin,verified:row.evidence.verified})),executable:false};
}
export async function readIpoResearch(db:PrismaClient,listingId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(listingId))throw new Error('INVALID_LISTING_ID');
 // Retain database microseconds for metadata visibility; JS Date truncation can hide a just-committed revision.
 const clocks=await db.$queryRaw<{cutoff:string}[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff`;
 const cutoff=clocks[0]!.cutoff,asOf=new Date(cutoff).toISOString(),at=utcInstant(asOf);
 const [rows,adjustments,calendars]=await Promise.all([
  db.$queryRaw<{id:string;evidence:IpoListingEvidence}[]>`SELECT "id","evidence" FROM "IpoListingSnapshot" WHERE "listingId"=${listingId}::uuid AND "knownAt"<=${cutoff}::timestamptz AND "recordedAt"<=${cutoff}::timestamptz ORDER BY "knownAt" DESC,"recordedAt" DESC,"id" LIMIT 1`,
  db.$queryRaw<{id:string;scaleSession:Date}[]>`SELECT "id","scaleSession" FROM "AdjustmentSnapshot" WHERE "listingId"=${listingId}::uuid AND "asOf"<=${at} AND "createdAt"<=${at} ORDER BY "asOf" DESC,"createdAt" DESC,"id" LIMIT 1`,
  db.$queryRaw<{id:string}[]>`SELECT "id" FROM "CalendarSnapshot" WHERE "createdAt"<=${at} ORDER BY "createdAt" DESC,"id" LIMIT 1`
 ]);
 let series:Awaited<ReturnType<typeof loadSeries>>['series']|null=null,sourceReason:string|null=null;
 if(adjustments[0]&&calendars[0])try{const loaded=await loadSeries(db,adjustments[0].id,{scanId:'research-only',session:adjustments[0].scaleSession.toISOString().slice(0,10),asOf,calendarId:calendars[0].id});if(loaded.listingId!==listingId)throw new Error('IPO_LISTING_MISMATCH');series=loaded.series}catch(error){if(error instanceof Error&&['ADJUSTMENT_UNAVAILABLE','CURRENT_SESSION_MISSING','CALENDAR_OR_COVERAGE_INCOMPLETE','CANDLE_FINALIZED_BEFORE_CALENDAR','INVALID_FINALIZED_SERIES','RAW_SOURCE_NOT_YET_KNOWN','IPO_LISTING_MISMATCH'].includes(error.message))sourceReason=error.message;else throw error}
 return {...ipoResearch(rows[0]?.evidence??null,series,asOf),sourceSession:series?.bars.at(-1)?.session??null,sourceAt:series?.bars.at(-1)?.finalizedAt??null,metadataRevision:rows[0]?.id??null,calendarRevision:calendars[0]?.id??null,sourceReason};
}
