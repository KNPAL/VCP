import type {PrismaClient} from '@prisma/client';
import {verifiedCalendar,type CalendarDay} from '@vcp/market-data';
export async function syncJobs(db:PrismaClient,input:{runId?:string;after?:string;limit?:number}={}){
 const limit=input.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('INVALID_JOB_LIMIT');
 const rows=await db.$queryRaw<{id:string;runId:string;listingId:string;provider:string;interval:string;fromSession:Date;toSession:Date;state:string;attempts:number;reason:string|null;nextAttemptAt:Date;report:unknown;parentId:string|null}[]>`SELECT w."id",w."runId",r."listingId",r."provider",r."interval",w."fromSession",w."toSession",w."state",w."attempts",w."reason",w."nextAttemptAt",w."report",w."parentId" FROM "HistoricalSyncWindow" w JOIN "HistoricalSyncRun" r ON r."id"=w."runId" WHERE (${input.runId??null}::uuid IS NULL OR w."runId"=${input.runId??null}::uuid) AND (${input.after??null}::uuid IS NULL OR w."id">${input.after??null}::uuid) ORDER BY w."id" LIMIT ${limit+1}`;
 return {items:rows.slice(0,limit).map(row=>({...row,fromSession:row.fromSession.toISOString().slice(0,10),toSession:row.toSession.toISOString().slice(0,10),nextAttemptAt:row.nextAttemptAt.toISOString(),retryStatus:row.state==='FAILED'?'MANUAL_REVIEW_REQUIRED':row.state==='PARTIAL'?'SCHEDULED':row.state==='RUNNING'?'LEASED':row.state})),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
}
export async function instrumentCoverage(db:PrismaClient,listingId:string,provider:string){
 const coverage=await db.$queryRaw<{fromSession:Date;watermark:Date|null;checkedAt:Date;evidence:{to?:string;calendarHash?:string;missing?:unknown}}[]>`SELECT * FROM "CandleCoverage" WHERE "listingId"=${listingId}::uuid AND "provider"=${provider}`;
 const row=coverage[0];
 const latest=await db.$queryRaw<{session:Date;revisionId:string;receivedAt:Date}[]>`SELECT "session","revisionId","receivedAt" FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid AND "provider"=${provider} ORDER BY "session" DESC LIMIT 1`;
 const rejected=await db.$queryRaw<{evidence:unknown;createdAt:Date}[]>`SELECT "evidence","createdAt" FROM "CandleQuarantine" WHERE "listingId"=${listingId}::uuid AND "provider"=${provider} ORDER BY "createdAt" DESC,"id" LIMIT 20`;
 const success=await db.$queryRaw<{at:Date}[]>`SELECT MAX(a."createdAt") AS "at" FROM "HistoricalSyncAttempt" a JOIN "HistoricalSyncWindow" w ON w."id"=a."windowId" JOIN "HistoricalSyncRun" r ON r."id"=w."runId" WHERE r."listingId"=${listingId}::uuid AND r."provider"=${provider} AND a."outcome"='COMPLETE'`;
 const counts=await db.$queryRaw<{state:string;count:number}[]>`SELECT w."state",COUNT(*)::integer AS "count" FROM "HistoricalSyncWindow" w JOIN "HistoricalSyncRun" r ON r."id"=w."runId" WHERE r."listingId"=${listingId}::uuid AND r."provider"=${provider} GROUP BY w."state"`;
 let holes:string[]|null=null,reason:string|null='COVERAGE_UNKNOWN';
 if(row?.evidence.to&&row.evidence.calendarHash){
  const calendars=await db.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${row.evidence.calendarHash}`;
  const targets=await db.$queryRaw<{toSession:Date}[]>`SELECT "toSession" FROM "HistoricalSyncRun" WHERE "listingId"=${listingId}::uuid AND "provider"=${provider} AND "asOf"<=${row.checkedAt} ORDER BY "toSession" DESC LIMIT 1`;
  const end=[row.evidence.to,latest[0]?.session.toISOString().slice(0,10)??'',targets[0]?.toSession.toISOString().slice(0,10)??''].sort().at(-1)!;
  const expected=verifiedCalendar(calendars[0]?.evidence??null,row.fromSession.toISOString().slice(0,10),end,row.checkedAt.toISOString());
  if(expected.state==='KNOWN'){
   const stored=await db.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${listingId}::uuid AND "provider"=${provider} AND "finalizedAt"<=${row.checkedAt} AND "receivedAt"<=${row.checkedAt}`;
   const dates=new Set(stored.map(bar=>bar.session.toISOString().slice(0,10)));holes=expected.sessions.filter(day=>!dates.has(day.date)).map(day=>day.date);reason=holes.length?'DATA_INCOMPLETE':null;
  }else reason='CALENDAR_UNKNOWN';
 }
 return {listingId,provider,interval:'ONE_DAY',status:holes===null?'UNKNOWN':holes.length?'INCOMPLETE':'COMPLETE',reason,asOf:row?.checkedAt.toISOString()??null,from:row?.fromSession.toISOString().slice(0,10)??null,watermark:row?.watermark?.toISOString().slice(0,10)??null,latestFinalSession:latest[0]?.session.toISOString().slice(0,10)??null,dataRevision:latest[0]?.revisionId??null,holes,lastSuccessfulSync:success[0]?.at?.toISOString()??null,latestResponse:row?.evidence??null,rejectedCandles:rejected,windowCounts:counts};
}
