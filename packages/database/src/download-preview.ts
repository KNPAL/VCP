import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {sessionDate} from '@vcp/domain';
import {canonicalListings,universeAt,previewDownloadRange,backfillHorizon,sourcePermission,HISTORICAL_ENDPOINT,candleHash,type InstrumentSnapshot,type UniverseSnapshot,type SourceRecord,type CalendarDay,type DailyCandle} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readBrokerHealth} from './data-health.js';
export interface DownloadPreviewRequest {universeId:string;listingIds?:string[];interval:'1d';fromDate:string;toDate:string;mode:'MISSING_ONLY'|'RECONCILE'}
export function validateDownloadPreviewRequest(value:unknown):DownloadPreviewRequest {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_DOWNLOAD_PREVIEW');
 const r=value as DownloadPreviewRequest;
 if(Object.keys(r).some(k=>!['universeId','listingIds','interval','fromDate','toDate','mode'].includes(k))||typeof r.universeId!=='string'||!r.universeId||r.interval!=='1d'||!['MISSING_ONLY','RECONCILE'].includes(r.mode))throw new Error('INVALID_DOWNLOAD_PREVIEW');
 try{sessionDate(r.fromDate);sessionDate(r.toDate)}catch{throw new Error('INVALID_DOWNLOAD_PREVIEW')}
 if(r.fromDate>r.toDate||r.fromDate<backfillHorizon(r.toDate).from||r.listingIds!==undefined&&(!Array.isArray(r.listingIds)||!r.listingIds.length||r.listingIds.length>500||new Set(r.listingIds).size!==r.listingIds.length||r.listingIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))))throw new Error('INVALID_DOWNLOAD_PREVIEW');
 return r;
}
/** Local evidence only: no provider call, queue dispatch or candle mutation. */
export async function readDownloadPreview(db:Pick<PrismaClient,'$queryRaw'>,ownerId:string,value:unknown,accountKey?:string){
 const request=validateDownloadPreviewRequest(value),checkedAt=new Date().toISOString(),at=new Date(checkedAt);
 const [universes,instruments,sources,broker]=await Promise.all([
 db.$queryRaw<{evidence:UniverseSnapshot}[]>`SELECT "evidence" FROM "UniverseSnapshot" WHERE "knownAt"<=${at}`,
 db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${at} ORDER BY "knownAt" DESC,"id" LIMIT 1`,
 db.$queryRaw<{id:string;evidence:SourceRecord}[]>`SELECT "id","evidence" FROM "SourceSnapshot" WHERE "dataset"='DAILY_CANDLES' AND "knownAt"<=${at} AND "evidence"->>'provider'='ANGEL_ONE' AND "evidence"->>'endpointOrFile'=${HISTORICAL_ENDPOINT} ORDER BY "knownAt" DESC,"id" LIMIT 1`,
 readBrokerHealth(db,accountKey)]);
 const universe=universeAt(universes.map(r=>r.evidence),checkedAt);
 if(request.universeId!=='NIFTY_500'&&request.universeId!==universe.snapshotId)throw new Error('DOWNLOAD_UNIVERSE_NOT_FOUND');
 const mapping=instruments[0]?.evidence,source=sources[0]?.evidence??null;
 const permissions=Object.fromEntries((['DISPLAY','DERIVE','DOWNLOAD','STORE'] as const).map(use=>[use,sourcePermission(source,use,checkedAt)]));
 if(permissions['DISPLAY']!.status==='FAIL'||permissions['DERIVE']!.status==='FAIL')throw new Error('DOWNLOAD_PREVIEW_PERMISSION_DENIED');
 const selected=new Set(request.listingIds),members=canonicalListings(mapping?[mapping]:[],universe.members,checkedAt);
 const blocked:{listingId:string|null;isin:string|null;reason:string}[]=[],items=[];
 const revisions:unknown[]=[];
 for(const member of members){
  const row=member.primary;
  if(request.listingIds&&!selected.has(row?.listingId??''))continue;
  if(!row){blocked.push({listingId:null,isin:member.isin,reason:member.reason??'MAPPING_UNKNOWN'});continue}
  if(row.provider!=='ANGEL_ONE'){blocked.push({listingId:row.listingId,isin:member.isin,reason:'PROVIDER_UNSUPPORTED'});continue}
  if(universe.state!=='KNOWN'||permissions['DISPLAY']!.status!=='PASS'||permissions['DERIVE']!.status!=='PASS'){blocked.push({listingId:row.listingId,isin:member.isin,reason:'UNIVERSE_OR_SOURCE_UNVERIFIED'});continue}
  const coverage=await db.$queryRaw<{evidence:{calendarHash?:string}}[]>`SELECT "evidence" FROM "CandleCoverage" WHERE "listingId"=${row.listingId}::uuid AND "provider"='ANGEL_ONE' AND "checkedAt"<=${at}`;
  const calendarId=coverage[0]?.evidence.calendarHash??null;
  const calendars=await db.$queryRaw<{evidence:CalendarDay[]|null}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${calendarId} AND "createdAt"<=${at}`;
  const stored=await db.$queryRaw<{session:Date;open:string;high:string;low:string;close:string;volume:string;finalizedAt:Date;receivedAt:Date;revisionId:string;contentHash:string}[]>`SELECT "session","open"::text,"high"::text,"low"::text,"close"::text,"volume"::text,"finalizedAt","receivedAt","revisionId","contentHash" FROM "RawDailyCandle" WHERE "listingId"=${row.listingId}::uuid AND "provider"='ANGEL_ONE' AND "session">=${new Date(request.fromDate)} AND "session"<=${new Date(request.toDate)} AND "receivedAt"<=${at} AND "finalizedAt"<=${at} ORDER BY "session"`;
  const bars:DailyCandle[]=stored.map(b=>{const bar={listingId:row.listingId,provider:'ANGEL_ONE',session:b.session.toISOString().slice(0,10),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,finalizedAt:b.finalizedAt.toISOString(),receivedAt:b.receivedAt.toISOString(),zeroVolumeVerified:false};return {...bar,zeroVolumeVerified:b.volume==='0'&&candleHash({...bar,zeroVolumeVerified:true})===b.contentHash}});
  // An observed provider candle is evidence only for its own session, not later market dates.
  const providerFinalSession=bars.at(-1)?.session===request.toDate?request.toDate:null;
  const plan=previewDownloadRange({...request,asOf:checkedAt,listingId:row.listingId,provider:'ANGEL_ONE',listingDate:row.listingDate,calendar:calendars[0]?.evidence??null,bars,providerFinalSession});
  revisions.push({listingId:row.listingId,calendarId,candles:stored.map(b=>[b.session.toISOString(),b.revisionId,b.contentHash])});
  items.push({listingId:row.listingId,isin:row.isin,symbol:row.symbol,exchange:row.exchange,calendarId,...plan});
 }
 for(const id of selected)if(!members.some(m=>m.primary?.listingId===id))blocked.push({listingId:id,isin:null,reason:'NOT_CANONICAL_UNIVERSE_LISTING'});
 const dataRevision=createHash('sha256').update(canonical(revisions)).digest('hex'),expiresAt=new Date(at.valueOf()+300000).toISOString();
 const warnings=[...(!broker.historyReady?['BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY']:[]),...(universe.state!=='KNOWN'?['UNIVERSE_UNKNOWN']:[]),...(!items.length?['NO_ELIGIBLE_LISTINGS']:[]),...Object.entries(permissions).flatMap(([use,p])=>p.status==='PASS'?[]:[use+':'+p.reasons.join(',')]),...items.flatMap(i=>i.reasons)];
 const evidence={request,checkedAt,expiresAt,universeSnapshotId:universe.snapshotId,instrumentSnapshotId:mapping?.id??null,sourceSnapshotId:sources[0]?.id??null,dataRevision,sourcePermissions:permissions,eligibleCount:items.length,blockedInstruments:blocked,items,alreadyStoredCount:items.reduce((n,i)=>n+i.alreadyStoredCount,0),missingCount:!items.length||universe.state!=='KNOWN'||items.some(i=>i.missingCount===null)||blocked.length?null:items.reduce((n,i)=>n+(i.missingCount??0),0),planWindowCount:items.reduce((n,i)=>n+i.planWindowCount,0),warnings:[...new Set(warnings)],quotaNote:'Estimates only; all jobs share account limits of at most 1 request/second, 60/minute and 3000/hour.',executable:false};
 return {previewId:createHash('sha256').update(canonical({ownerId,...evidence})).digest('hex'),...evidence};
}
