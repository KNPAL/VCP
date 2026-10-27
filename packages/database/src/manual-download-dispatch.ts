import {randomUUID} from 'node:crypto';
import {exchangeDate} from '@vcp/domain';
import type {PrismaClient} from '@prisma/client';
import {verifiedCalendar,missingWindows,normalizeHistoricalResponse,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readDownloadPreview,type DownloadPreviewRequest} from './download-preview.js';
/** Atomically materialize one accepted request into the existing durable backfill pipeline. */
export async function prepareManualDownload(db:PrismaClient){
 return db.$transaction(async tx=>{
  const runs=await tx.$queryRaw<{id:string;ownerId:string;evidence:{brokerConfigurationRevision?:string|null;accountKey:string;request:DownloadPreviewRequest;instrumentSnapshotId:string;universeSnapshotId:string;sourceSnapshotId:string;items:{listingId:string;rangesToFetch:{sessions:string[]}[]}[]}}[]>`SELECT "id","ownerId","evidence" FROM "ManualDownloadRun" WHERE "state"='QUEUED' ORDER BY "createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
  const run=runs[0];if(!run)return {state:'IDLE',children:0};
  const at=new Date().toISOString(),accepted=run.evidence;
  const change=async(state:string,reason:string,children=0)=>{await tx.$executeRaw`UPDATE "ManualDownloadRun" SET "state"=${state} WHERE "id"=${run.id}::uuid`;await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${run.id}::uuid,${state},${canonical({reason,children})}::jsonb)`;return {state,runId:run.id,children}};
  let current;try{current=await readDownloadPreview(tx,run.ownerId,accepted.request,accepted.accountKey)}catch(error){if(error instanceof Error&&['DOWNLOAD_PREVIEW_PERMISSION_DENIED','DOWNLOAD_UNIVERSE_NOT_FOUND'].includes(error.message))return change('PARTIAL','PINNED_CONTEXT_UNAVAILABLE');throw error}
  if(current.brokerConfigurationRevision!==(accepted.brokerConfigurationRevision??null))return change('PARTIAL','BROKER_CONFIGURATION_CHANGED');
  if(current.warnings.includes('BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'))return change('PAUSED_AUTH','BROKER_HISTORY_UNAVAILABLE');
  if(current.instrumentSnapshotId!==accepted.instrumentSnapshotId||current.universeSnapshotId!==accepted.universeSnapshotId||current.sourceSnapshotId!==accepted.sourceSnapshotId)return change('PARTIAL','PINNED_CONTEXT_CHANGED');
  if(!current.items.length||current.blockedInstruments.length||current.items.some(i=>i.state!=='KNOWN')||Object.values(current.sourcePermissions).some(p=>p.status!=='PASS'))return change('PARTIAL','DOWNLOAD_EVIDENCE_UNAVAILABLE');
  const credentials=await tx.$queryRaw<{reference:string}[]>`SELECT b."reference" FROM "BrokerCredential" b JOIN "BrokerCircuit" c ON c."accountKey"=b."accountKey" AND c."sessionRevision"=b."sessionRevision" WHERE b."accountKey"=${accepted.accountKey} AND NOT c."open" AND c."verifiedAt"<=${new Date(at)} AND c."expiresAt">${new Date(at)} AND b."expiresAt"=c."expiresAt"`;
  if(credentials.length!==1)return change('PAUSED_AUTH','BROKER_SESSION_UNAVAILABLE');
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${accepted.instrumentSnapshotId}`;
  const epochs=await tx.$queryRaw<{generation:number}[]>`SELECT COALESCE(max("generation"),-1)::integer AS generation FROM "ManualDownloadChild" WHERE "manualRunId"=${run.id}::uuid`;
  const generation=epochs[0]!.generation+1;let children=0;
  for(const item of current.items){
   const generations=await tx.$queryRaw<{generation:number}[]>`SELECT "generation" FROM "ManualDownloadChild" WHERE "manualRunId"=${run.id}::uuid AND "listingId"=${item.listingId}::uuid ORDER BY "generation" DESC LIMIT 1`;
   let windows=item.rangesToFetch;
   if(generations[0]){
    const attempts=await tx.$queryRaw<{expectedSessions:string[];evidence:{actualResponseCount?:number;calendarReasons?:string[];missing?:{session:string}[]}}[]>`SELECT w."expectedSessions",a."evidence" FROM "HistoricalSyncAttempt" a JOIN "HistoricalSyncWindow" w ON w."id"=a."windowId" JOIN "ManualDownloadChild" c ON c."syncRunId"=w."runId" WHERE c."manualRunId"=${run.id}::uuid AND c."listingId"=${item.listingId}::uuid`;
    const completed=new Set<string>();for(const attempt of attempts){const report=attempt.evidence;if(!Array.isArray(report.missing)||!Array.isArray(report.calendarReasons)||report.calendarReasons.length)continue;const missing=new Set(report.missing.map(m=>m.session)),done=attempt.expectedSessions.filter(d=>!missing.has(d));if(done.length===report.actualResponseCount)for(const date of done)completed.add(date)}
    const targets=new Set(accepted.items.find(i=>i.listingId===item.listingId)?.rangesToFetch.flatMap(w=>w.sessions)??[]);
    const currentMissing=new Set(item.rangesToFetch.flatMap(w=>w.sessions));
    const calendarRows=await tx.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${item.calendarId}`;
    const excluded=item.excludedDates.find(d=>d.reason==='BEFORE_LISTING'),from=excluded?new Date(Date.parse(excluded.to+'T00:00:00Z')+86400000).toISOString().slice(0,10):accepted.request.fromDate;
    const sessions=verifiedCalendar(calendarRows[0]?.evidence??null,from,accepted.request.toDate,at).sessions.map(d=>d.date);
    windows=missingWindows(sessions,sessions.filter(d=>!targets.has(d)||completed.has(d)||(accepted.request.mode==='MISSING_ONLY'&&!currentMissing.has(d))));
   }
   if(!windows.length)continue;
   const calendars=await tx.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${item.calendarId}`;
   const calendar=calendars[0]?.evidence,mapping=mappings[0]?.evidence,row=mapping?.rows.find(r=>r.listingId===item.listingId&&r.provider==='ANGEL_ONE'&&r.validFrom<=exchangeDate(at)&&(r.validTo===null||r.validTo>exchangeDate(at)));
   if(!calendar||!mapping||!row)throw new Error('MANUAL_DOWNLOAD_CONTEXT_UNAVAILABLE');
   const from=windows[0]!.from,to=windows.at(-1)!.to;
   if(verifiedCalendar(calendar,from,to,at).state!=='KNOWN'||normalizeHistoricalResponse({listingId:item.listingId,mapping,calendar,request:{exchange:row.exchange,symbolToken:row.token,from,to},receivedAt:at,rows:[]}).status==='UNKNOWN')throw new Error('MANUAL_DOWNLOAD_CONTEXT_UNAVAILABLE');
   const id=randomUUID(),input={id,listingId:item.listingId,provider:'ANGEL_ONE',from,to,asOf:at,calendar,windows};
   await tx.$executeRaw`INSERT INTO "HistoricalSyncRun" ("id","listingId","provider","fromSession","toSession","asOf","evidence") VALUES (${id}::uuid,${item.listingId}::uuid,'ANGEL_ONE',${new Date(from)},${new Date(to)},${new Date(at)},${canonical(input)}::jsonb)`;
   for(const window of windows)await tx.$executeRaw`INSERT INTO "HistoricalSyncWindow" ("id","runId","fromSession","toSession","expectedSessions","state") VALUES (${randomUUID()}::uuid,${id}::uuid,${new Date(window.from)},${new Date(window.to)},${canonical(window.sessions)}::jsonb,'PENDING')`;
   const binding={runId:id,credentialReference:credentials[0]!.reference,instrumentSnapshotId:accepted.instrumentSnapshotId,sourceSnapshotId:accepted.sourceSnapshotId,exchange:row.exchange,symbolToken:row.token};
   await tx.$executeRaw`INSERT INTO "BackfillBinding" ("runId","credentialReference","evidence") VALUES (${id}::uuid,${credentials[0]!.reference}::uuid,${canonical(binding)}::jsonb)`;
   await tx.$executeRaw`INSERT INTO "ManualDownloadChild" ("manualRunId","listingId","syncRunId","generation") VALUES (${run.id}::uuid,${item.listingId}::uuid,${id}::uuid,${generation})`;children++;
  }
  return change(children?'RUNNING':current.items.every(i=>i.missingCount===0)?'COMPLETED':'PARTIAL',children?'SYNC_WINDOWS_PREPARED':current.items.every(i=>i.missingCount===0)?'COVERAGE_ALREADY_COMPLETE':'COVERAGE_INCOMPLETE',children);
 },{isolationLevel:'Serializable',timeout:60000});
}
