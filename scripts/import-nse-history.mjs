import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PrismaClient,persistSource} from '../packages/database/dist/index.js';
const sourcePath=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: node scripts/import-nse-history.mjs <source.db> [--apply]');
const apply=process.argv.includes('--apply'),tables=['securities','universes','universe_memberships','source_files','daily_prices','download_jobs','download_job_dates'];
const source=new DatabaseSync(sourcePath,{readOnly:true}),data={},digest=createHash('sha256');
try{source.exec('BEGIN');for(const table of tables){data[table]=source.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();digest.update(table);for(const row of data[table])digest.update(JSON.stringify(row)+'\n')}source.exec('COMMIT');}finally{source.close()}
const fingerprint=digest.digest('hex'),prices=data.daily_prices,dates=prices.map(r=>r.trade_date).sort();
const password=(await readFile('.runtime/database-password','utf8')).trim();
const db=new PrismaClient({datasources:{db:{url:`postgresql://vcp:${encodeURIComponent(password)}@127.0.0.1:55432/vcp`}}});
try{
 const owners=await db.owner.findMany({select:{id:true}});if(owners.length!==1)throw new Error('Expected exactly one local owner');
 const ownerId=owners[0].id,id=createHash('sha256').update(ownerId+fingerprint).digest('hex'),at=new Date().toISOString();
 const report={id,sourcePath,fingerprint,counts:Object.fromEntries(tables.map(t=>[t,data[t].length])),priceRows:prices.length,symbols:new Set(prices.map(p=>p.symbol)).size,from:dates[0],to:dates.at(-1),priceBasis:'UNADJUSTED',sourcePrecision:'Source SQLite FLOAT values normalized to six decimal places; original rows retained',membershipBasis:'Current membership; not point-in-time history',quality:{accepted:0,flagged:0,reasons:{}}};
 if(!prices.length)throw new Error('Source has no prices');
 const validDates=new Set(data.source_files.filter(r=>r.validation_status==='valid').map(r=>r.trade_date));
 const calendarRows=await db.$queryRaw`SELECT evidence FROM "CalendarSnapshot" WHERE id=(SELECT evidence->>'planningCalendarHash' FROM "CandleCoverage" WHERE evidence ? 'planningCalendarHash' LIMIT 1)`;
 const calendar=new Map((calendarRows[0]?.evidence??[]).map(d=>[d.date,d]));
 const normalized=prices.map(p=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.trade_date)||new Date(p.trade_date).toISOString().slice(0,10)!==p.trade_date)throw new Error('Invalid source date');
  const reasons=[],day=calendar.get(p.trade_date);
  for(const field of ['open','high','low','close'])if(!Number.isFinite(p[field])||Math.abs(p[field])>=1e14)throw new Error('Nonrepresentable price in source row '+p.id);
  if(!Number.isSafeInteger(p.volume))throw new Error('Nonrepresentable volume in source row '+p.id);
  if([p.open,p.high,p.low,p.close].some(v=>v<=0)||p.high<Math.max(p.open,p.low,p.close)||p.low>Math.min(p.open,p.high,p.close))reasons.push('INVALID_OHLC');
  if(p.volume<=0)reasons.push('NONPOSITIVE_VOLUME');
  if(!validDates.has(p.trade_date))reasons.push('SOURCE_FILE_NOT_VALIDATED');
  if(!day?.verified)reasons.push('CALENDAR_UNVERIFIED');else if(day.kind==='HOLIDAY')reasons.push('CALENDAR_CLOSED');
  if(!day?.finalizedAt||day.finalizedAt>at)reasons.push('SESSION_NOT_FINALIZED');
  if(p.series==='NAN'||!p.symbol||!p.series)reasons.push('INVALID_IDENTITY');
  if(reasons.length)report.quality.flagged++;else report.quality.accepted++;
  for(const reason of reasons)report.quality.reasons[reason]=(report.quality.reasons[reason]??0)+1;
  return {symbol:p.symbol,series:p.series,session:p.trade_date,open:p.open.toFixed(6),high:p.high.toFixed(6),low:p.low.toFixed(6),close:p.close.toFixed(6),volume:String(p.volume),source:p.source,quality:reasons.length?'FLAGGED':'VALID',reasons};
 });
 if(apply){
  const previous=await db.$queryRaw`SELECT status FROM "HistoricalDataImport" WHERE id=${id}`;
  if(previous[0]?.status==='COMPLETED'){console.log(JSON.stringify({...report,reused:true}));process.exitCode=0;}
  else{
   const sourceRecord=await persistSource(db,{dataset:'DAILY_CANDLES',provider:'NSE_BHAVCOPY_IMPORT',endpointOrFile:'local:historical-import/'+fingerprint,licenseRef:'OWNER_DECLARED_PERSONAL_USE:'+ownerId+':'+at+'; local research; no redistribution',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'Immutable local historical snapshot; manually reimport newer data',asOf:at,knownAt:at,effectiveAt:at,validUntil:'2099-01-01T00:00:00.000Z',lastVerified:at,maximumAgeMs:36525*86400000,adjustmentPolicy:'UNADJUSTED; no corporate-action verification; no trading eligibility',coverage:{intended:prices.length,available:report.quality.accepted},error:null});
   await db.$executeRaw`INSERT INTO "HistoricalDataImport" (id,"ownerId","sourceSnapshotId",status,manifest) VALUES (${id},${ownerId}::uuid,${sourceRecord.id},'IMPORTING',${JSON.stringify(report)}::jsonb) ON CONFLICT (id) DO UPDATE SET "sourceSnapshotId"=EXCLUDED."sourceSnapshotId"`;
   for(const table of tables){
    for(let offset=0;offset<data[table].length;offset+=2000){const rows=data[table].slice(offset,offset+2000);await db.$executeRaw`INSERT INTO "HistoricalImportRecord" ("importId","sourceTable","sourceId",evidence) SELECT ${id},${table},r->>'id',r FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) r ON CONFLICT DO NOTHING`;}
    console.log('Copied '+table+': '+data[table].length);
   }
   for(let offset=0;offset<normalized.length;offset+=2000){await db.$executeRaw`INSERT INTO "HistoricalResearchBar" ("importId",symbol,series,session,open,high,low,close,volume,source,quality,reasons) SELECT ${id},r->>'symbol',r->>'series',(r->>'session')::date,(r->>'open')::numeric,(r->>'high')::numeric,(r->>'low')::numeric,(r->>'close')::numeric,(r->>'volume')::bigint,r->>'source',r->>'quality',r->'reasons' FROM jsonb_array_elements(${JSON.stringify(normalized.slice(offset,offset+2000))}::jsonb) r ON CONFLICT DO NOTHING`;if(offset%20000===0)console.log('Indexed prices: '+Math.min(offset+2000,normalized.length)+'/'+normalized.length)}
   const counts=await db.$queryRaw`SELECT "sourceTable",count(*)::int n FROM "HistoricalImportRecord" WHERE "importId"=${id} GROUP BY "sourceTable"`;
   for(const table of tables)if((counts.find(r=>r.sourceTable===table)?.n??0)!==data[table].length)throw new Error('Copy verification failed: '+table);
   const [bars]=await db.$queryRaw`SELECT count(*)::int n FROM "HistoricalResearchBar" WHERE "importId"=${id}`;
   if(bars.n!==prices.length)throw new Error('Research index count mismatch');
   await db.$executeRaw`UPDATE "HistoricalDataImport" SET status='COMPLETED' WHERE id=${id}`;
   console.log(JSON.stringify({...report,verified:true}));
  }
 }else console.log(JSON.stringify(report,null,2));
 await writeFile('.runtime/nse-history-import-report.json',JSON.stringify(report,null,2));
}catch(e){console.error(e.message);process.exitCode=1}finally{await db.$disconnect()}
