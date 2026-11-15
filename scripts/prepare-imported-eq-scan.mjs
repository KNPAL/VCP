import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PrismaClient} from '../packages/database/dist/index.js';
import {verifiedCalendar} from '../packages/market-data/dist/index.js';
import {classifyNseAction} from './nse-action-rules.mjs';
const folder='.runtime/official-nse/',target='2026-11-11',asOf=new Date().toISOString();
const date=value=>new Date(value+' 00:00:00 GMT').toISOString().slice(0,10);
const manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
const actions=[],benchmark=[];
for(const file of manifest.files){const bytes=await readFile(folder+file.file);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Official file hash mismatch');let rows=JSON.parse(bytes.toString('utf8'));if(typeof rows==='string')rows=JSON.parse(rows);if(file.file.startsWith('actions-'))actions.push(...rows);else benchmark.push(...rows.map(r=>({session:date(r.HistoricalDate),open:r.OPEN,high:r.HIGH,low:r.LOW,close:r.CLOSE})));}
const latest=[];for(const day of ['20260201','20261108','20261111'])latest.push(...JSON.parse(await readFile(folder+'bhavcopy-'+day+'.json','utf8')));
const audit=JSON.parse(await readFile(folder+'equity-audit.json','utf8'));
const pw=(await readFile('.runtime/database-password','utf8')).trim(),db=new PrismaClient({datasources:{db:{url:`postgresql://vcp:${encodeURIComponent(pw)}@127.0.0.1:55432/vcp`}}});
try{
 const [batch]=await db.$queryRaw`SELECT id FROM "HistoricalDataImport" WHERE status='COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`;
 const [calendar]=await db.$queryRaw`SELECT id,evidence FROM "CalendarSnapshot" WHERE id=(SELECT evidence->>'planningCalendarHash' FROM "CandleCoverage" WHERE evidence ? 'planningCalendarHash' LIMIT 1)`;
 const checked=verifiedCalendar(calendar.evidence,'2020-01-01',target,asOf);if(checked.state!=='KNOWN')throw new Error('Calendar unavailable');
 const sessions=checked.sessions.slice(-300),from=sessions[0].date,expected=sessions.map(d=>d.date),bmap=new Map(benchmark.map(b=>[b.session,b]));
 const benchmarkGaps=expected.filter(s=>!bmap.has(s));
 const imported=await db.$queryRaw`SELECT symbol,session::text,open::text,high::text,low::text,close::text,volume::text FROM "HistoricalResearchBar" WHERE "importId"=${batch.id} AND series='EQ' AND quality='VALID' AND session>=${new Date(from)} AND session<=${new Date(target)} ORDER BY symbol,session`;
 const stocks=[];
 for(const stock of audit){
  const reasons=[],bars=imported.filter(b=>b.symbol===stock.symbol),extra=latest.filter(r=>r.TckrSymb===stock.symbol&&r.SctySrs==='EQ'&&r.TradDt>=from&&r.TradDt<=target);
  if(!stock.listingId)reasons.push('INSTRUMENT_IDENTITY_UNRESOLVED');
  for(const r of extra)if(r.ISIN===stock.isin&&!bars.some(b=>b.session===r.TradDt))bars.push({symbol:stock.symbol,session:r.TradDt,open:r.OpnPric,high:r.HghPric,low:r.LwPric,close:r.ClsPric,volume:r.TtlTradgVol});bars.sort((a,b)=>a.session.localeCompare(b.session));
  const available=new Set(bars.map(b=>b.session)),missing=expected.filter(s=>!available.has(s));if(missing.length)reasons.push('MISSING_SESSIONS');
  const events=actions.filter(a=>a.symbol===stock.symbol&&date(a.exDate)>from&&date(a.exDate)<=target).map(a=>({...a,session:date(a.exDate),classification:classifyNseAction(a.subject)}));
  const unsupported=events.filter(a=>a.classification.kind==='UNSUPPORTED');if(unsupported.length)reasons.push('UNSUPPORTED_CORPORATE_ACTION');
  const adjustments=events.filter(a=>['SPLIT','BONUS'].includes(a.classification.kind));
  stocks.push({...stock,actions:undefined,bars,missing,unsupported,adjustments,reasons});
 }
 const prepared={scope:'IMPORTED_EQ_RESEARCH',importId:batch.id,target,from,asOf,calendarId:calendar.id,sessions,benchmark:expected.map(s=>bmap.get(s)),benchmarkGaps,stocks,officialSources:manifest.files};
 await writeFile(folder+'prepared-scan.json',JSON.stringify(prepared));
 const counts={target,from,expectedSessions:expected.length,benchmarkGaps,stocks:stocks.length,readyBeforeActionBasis:stocks.filter(s=>!s.reasons.length).length,blocked:stocks.filter(s=>s.reasons.length).map(s=>({symbol:s.symbol,reasons:s.reasons,missing:s.missing.length,actions:s.unsupported.map(a=>a.subject)})),actionBasisRequired:stocks.filter(s=>!s.reasons.length&&s.adjustments.length).map(s=>({symbol:s.symbol,actions:s.adjustments.map(a=>({date:a.session,subject:a.subject}))}))};
 await writeFile(folder+'readiness-report.json',JSON.stringify(counts,null,2));console.log(JSON.stringify({...counts,blocked:counts.blocked.filter(s=>s.reasons.length)},null,2));
}finally{await db.$disconnect()}
