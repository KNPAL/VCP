import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {inspectCandleBatch,candleHash,verifiedCalendar} from '@vcp/market-data';
import {canonical} from './indicators.js';
import {assertProviderPermissions} from './data-permissions.js';
type ImportInput=Parameters<typeof inspectCandleBatch>[0];
export interface IngestReport {state:string;calendarHash:string;expectedCount:number;actualResponseCount:number;missing:{session:string;reason:string}[];calendarReasons:string[];inserted:number;revised:number;unchanged:number;quarantined:number;watermark:string|null;changes:string[]}
export async function ingestCandles(db:PrismaClient,input:ImportInput,onCommit?:(tx:Prisma.TransactionClient,report:IngestReport)=>Promise<void>){
 // Quarantined payloads are storage too, including bars from an unexpected provider.
 const providers=[...new Set([input.provider,...input.bars.map(bar=>bar.provider)])].sort();
 const storagePermission=async()=>{for(const provider of providers)await assertProviderPermissions(db,'DAILY_CANDLES',provider,['STORE'])};
 await storagePermission();
 const inspected=inspectCandleBatch(input),checkedAt=new Date(input.asOf);
 for(let attempt=0;attempt<4;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.listingId},0))`;
  // Read current authority outside the serializable market-data snapshot after a lock wait.
  await storagePermission();
  const coverage=await tx.$queryRaw<{fromSession:Date;watermark:Date|null;checkedAt:Date}[]>`SELECT "fromSession","watermark","checkedAt" FROM "CandleCoverage" WHERE "listingId"=${input.listingId}::uuid AND "provider"=${input.provider}`;
  if(coverage[0]&&checkedAt<coverage[0].checkedAt)throw new Error('STALE_CONFLICT: coverage observation is older than stored evidence');
  const calendarJson=canonical(input.calendar),calendarHash=createHash('sha256').update(calendarJson).digest('hex');
  await tx.$executeRaw`INSERT INTO "CalendarSnapshot" ("id","evidence") VALUES (${calendarHash},${calendarJson}::jsonb) ON CONFLICT ("id") DO NOTHING`;
  let inserted=0,revised=0,unchanged=0;const changes:string[]=[];
  for(const entry of inspected.quarantined){const evidence=canonical(entry);await tx.$executeRaw`INSERT INTO "CandleQuarantine" ("id","listingId","provider","evidence") VALUES (${randomUUID()}::uuid,${input.listingId}::uuid,${input.provider},${evidence}::jsonb)`}
  for(const bar of inspected.accepted){
   const session=new Date(bar.session+'T00:00:00Z'),hash=candleHash(bar);
   const existing=await tx.$queryRaw<{revisionId:string;contentHash:string;receivedAt:Date}[]>`SELECT "revisionId","contentHash","receivedAt" FROM "RawDailyCandle" WHERE "listingId"=${bar.listingId}::uuid AND "session"=${session} AND "provider"=${bar.provider}`;
   if(existing[0]?.contentHash===hash){unchanged++;continue}
   if(existing[0]&&new Date(bar.receivedAt)<=existing[0].receivedAt)throw new Error('STALE_CONFLICT: candle observation does not follow stored revision');
   const latest=await tx.candleRevision.aggregate({where:{listingId:bar.listingId,session,scale:'RAW'},_max:{revision:true}});
   const revision=await tx.candleRevision.create({data:{id:randomUUID(),listingId:bar.listingId,session,scale:'RAW',revision:(latest._max.revision??0)+1,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:BigInt(bar.volume),source:bar.provider,receivedAt:new Date(bar.receivedAt),finalizedAt:new Date(bar.finalizedAt!)}});
   await tx.$executeRaw`INSERT INTO "RawDailyCandle" ("listingId","session","provider","revisionId","contentHash","open","high","low","close","volume","finalizedAt","receivedAt") VALUES (${bar.listingId}::uuid,${session},${bar.provider},${revision.id}::uuid,${hash},${bar.open}::numeric,${bar.high}::numeric,${bar.low}::numeric,${bar.close}::numeric,${BigInt(bar.volume)},${new Date(bar.finalizedAt!)},${new Date(bar.receivedAt)}) ON CONFLICT ("listingId","session","provider") DO UPDATE SET "revisionId"=EXCLUDED."revisionId","contentHash"=EXCLUDED."contentHash","open"=EXCLUDED."open","high"=EXCLUDED."high","low"=EXCLUDED."low","close"=EXCLUDED."close","volume"=EXCLUDED."volume","finalizedAt"=EXCLUDED."finalizedAt","receivedAt"=EXCLUDED."receivedAt"`;
   const eventId=randomUUID();await tx.$executeRaw`INSERT INTO "CandleChangeOutbox" ("id","listingId","session","provider","beforeRevisionId","afterRevisionId","calendarHash") VALUES (${eventId}::uuid,${bar.listingId}::uuid,${session},${bar.provider},${existing[0]?.revisionId??null}::uuid,${revision.id}::uuid,${calendarHash})`;
   changes.push(eventId);if(existing[0])revised++;else inserted++;
  }
  const previous=coverage[0],previousFrom=previous?.fromSession.toISOString().slice(0,10),from=previousFrom&&previousFrom<input.from?previousFrom:input.from;
  const reset=previousFrom!==undefined&&input.from<previousFrom;
  const priorWatermark=reset?null:previous?.watermark??null;
  const start=priorWatermark?.toISOString().slice(0,10)??from;
  const calendar=start<=input.to?verifiedCalendar(input.calendar,start,input.to,input.asOf):{state:'KNOWN',sessions:[],reasons:[]};
  const stored=await tx.$queryRaw<{session:Date}[]>`SELECT "session" FROM "RawDailyCandle" WHERE "listingId"=${input.listingId}::uuid AND "provider"=${input.provider} AND "session">=${new Date(start)} AND "session"<=${new Date(input.to)} AND "finalizedAt"<=${checkedAt}`;
  const dates=new Set(stored.map(row=>row.session.toISOString().slice(0,10)));let watermark=priorWatermark;
  if(calendar.state==='KNOWN')for(const day of calendar.sessions){if(!dates.has(day.date))break;watermark=new Date(day.date+'T00:00:00Z')}
  const report={state:inspected.state,from:input.from,to:input.to,calendarHash,expectedCount:inspected.expectedCount,actualResponseCount:inspected.actualCount,missing:inspected.missing,calendarReasons:calendar.reasons,inserted,revised,unchanged,quarantined:inspected.quarantined.length,watermark:watermark?.toISOString().slice(0,10)??null,changes};
  const evidence=canonical(report);await tx.$executeRaw`INSERT INTO "CandleCoverage" ("listingId","provider","fromSession","watermark","checkedAt","evidence") VALUES (${input.listingId}::uuid,${input.provider},${new Date(from)},${watermark},${checkedAt},${evidence}::jsonb) ON CONFLICT ("listingId","provider") DO UPDATE SET "fromSession"=EXCLUDED."fromSession","watermark"=EXCLUDED."watermark","checkedAt"=EXCLUDED."checkedAt","evidence"=EXCLUDED."evidence"`;
  if(onCommit)await onCommit(tx,report);
  await storagePermission();
  return report;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000})}catch(error){
  const retryable=error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2002'||(error.code==='P2010'&&['40001','40P01'].includes(String(error.meta?.['code']))));if(retryable&&attempt<3)continue;throw error;
 }
 throw new Error('CANDLE_TRANSACTION_RETRY_EXHAUSTED');
}
