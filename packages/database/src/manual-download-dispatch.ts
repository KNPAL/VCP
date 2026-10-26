import {randomUUID} from 'node:crypto';
import {exchangeDate} from '@vcp/domain';
import type {PrismaClient} from '@prisma/client';
import {verifiedCalendar,normalizeHistoricalResponse,type CalendarDay,type InstrumentSnapshot} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {readDownloadPreview,type DownloadPreviewRequest} from './download-preview.js';
/** Atomically materialize one accepted request into the existing durable backfill pipeline. */
export async function prepareManualDownload(db:PrismaClient){
 return db.$transaction(async tx=>{
  const runs=await tx.$queryRaw<{id:string;ownerId:string;evidence:{accountKey:string;request:DownloadPreviewRequest;instrumentSnapshotId:string;universeSnapshotId:string;sourceSnapshotId:string}}[]>`SELECT "id","ownerId","evidence" FROM "ManualDownloadRun" WHERE "state"='QUEUED' ORDER BY "createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
  const run=runs[0];if(!run)return {state:'IDLE',children:0};
  const at=new Date().toISOString(),accepted=run.evidence;
  const change=async(state:string,reason:string,children=0)=>{await tx.$executeRaw`UPDATE "ManualDownloadRun" SET "state"=${state} WHERE "id"=${run.id}::uuid`;await tx.$executeRaw`INSERT INTO "ManualDownloadEvent" ("id","runId","state","evidence") VALUES (${randomUUID()}::uuid,${run.id}::uuid,${state},${canonical({reason,children})}::jsonb)`;return {state,runId:run.id,children}};
  let current;try{current=await readDownloadPreview(tx,run.ownerId,accepted.request,accepted.accountKey)}catch(error){if(error instanceof Error&&['DOWNLOAD_PREVIEW_PERMISSION_DENIED','DOWNLOAD_UNIVERSE_NOT_FOUND'].includes(error.message))return change('PARTIAL','PINNED_CONTEXT_UNAVAILABLE');throw error}
  if(current.warnings.includes('BROKER_HISTORY_UNAVAILABLE_LOCAL_PREVIEW_ONLY'))return change('PAUSED_AUTH','BROKER_HISTORY_UNAVAILABLE');
  if(current.instrumentSnapshotId!==accepted.instrumentSnapshotId||current.universeSnapshotId!==accepted.universeSnapshotId||current.sourceSnapshotId!==accepted.sourceSnapshotId)return change('PARTIAL','PINNED_CONTEXT_CHANGED');
  if(!current.items.length||current.blockedInstruments.length||current.items.some(i=>i.state!=='KNOWN')||Object.values(current.sourcePermissions).some(p=>p.status!=='PASS'))return change('PARTIAL','DOWNLOAD_EVIDENCE_UNAVAILABLE');
  const credentials=await tx.$queryRaw<{reference:string}[]>`SELECT b."reference" FROM "BrokerCredential" b JOIN "BrokerCircuit" c ON c."accountKey"=b."accountKey" AND c."sessionRevision"=b."sessionRevision" WHERE b."accountKey"=${accepted.accountKey} AND NOT c."open" AND c."verifiedAt"<=${new Date(at)} AND c."expiresAt">${new Date(at)} AND b."expiresAt"=c."expiresAt"`;
  if(credentials.length!==1)return change('PAUSED_AUTH','BROKER_SESSION_UNAVAILABLE');
  const mappings=await tx.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "id"=${accepted.instrumentSnapshotId}`;
  let children=0;
  for(const item of current.items){
   if(!item.rangesToFetch.length)continue;
   const calendars=await tx.$queryRaw<{evidence:CalendarDay[]}[]>`SELECT "evidence" FROM "CalendarSnapshot" WHERE "id"=${item.calendarId}`;
   const calendar=calendars[0]?.evidence,mapping=mappings[0]?.evidence,row=mapping?.rows.find(r=>r.listingId===item.listingId&&r.provider==='ANGEL_ONE'&&r.validFrom<=exchangeDate(at)&&(r.validTo===null||r.validTo>exchangeDate(at)));
   if(!calendar||!mapping||!row)throw new Error('MANUAL_DOWNLOAD_CONTEXT_UNAVAILABLE');
   const from=item.rangesToFetch[0]!.from,to=item.rangesToFetch.at(-1)!.to;
   if(verifiedCalendar(calendar,from,to,at).state!=='KNOWN'||normalizeHistoricalResponse({listingId:item.listingId,mapping,calendar,request:{exchange:row.exchange,symbolToken:row.token,from,to},receivedAt:at,rows:[]}).status==='UNKNOWN')throw new Error('MANUAL_DOWNLOAD_CONTEXT_UNAVAILABLE');
   const id=randomUUID(),input={id,listingId:item.listingId,provider:'ANGEL_ONE',from,to,asOf:at,calendar,windows:item.rangesToFetch};
   await tx.$executeRaw`INSERT INTO "HistoricalSyncRun" ("id","listingId","provider","fromSession","toSession","asOf","evidence") VALUES (${id}::uuid,${item.listingId}::uuid,'ANGEL_ONE',${new Date(from)},${new Date(to)},${new Date(at)},${canonical(input)}::jsonb)`;
   for(const window of item.rangesToFetch)await tx.$executeRaw`INSERT INTO "HistoricalSyncWindow" ("id","runId","fromSession","toSession","expectedSessions","state") VALUES (${randomUUID()}::uuid,${id}::uuid,${new Date(window.from)},${new Date(window.to)},${canonical(window.sessions)}::jsonb,'PENDING')`;
   const binding={runId:id,credentialReference:credentials[0]!.reference,instrumentSnapshotId:accepted.instrumentSnapshotId,sourceSnapshotId:accepted.sourceSnapshotId,exchange:row.exchange,symbolToken:row.token};
   await tx.$executeRaw`INSERT INTO "BackfillBinding" ("runId","credentialReference","evidence") VALUES (${id}::uuid,${credentials[0]!.reference}::uuid,${canonical(binding)}::jsonb)`;
   await tx.$executeRaw`INSERT INTO "ManualDownloadChild" ("manualRunId","listingId","syncRunId") VALUES (${run.id}::uuid,${item.listingId}::uuid,${id}::uuid)`;children++;
  }
  return change(children?'RUNNING':'COMPLETED',children?'SYNC_WINDOWS_PREPARED':'COVERAGE_ALREADY_COMPLETE',children);
 },{isolationLevel:'Serializable',timeout:60000});
}
