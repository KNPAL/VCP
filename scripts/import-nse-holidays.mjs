import {readFile} from 'node:fs/promises';
import {PrismaClient} from '../packages/database/dist/index.js';
import {validateHolidayData} from './nse-holiday-data.mjs';

const args=process.argv.slice(2);
if(args.some(arg=>!['--apply','--report'].includes(arg))||args.length>1)throw new Error('Use --apply to import or --report to read database totals; no argument validates the dataset');
const data=JSON.parse(await readFile(new URL('../data/nse-cm-holidays-2015-2026.json',import.meta.url),'utf8'));
const datasetHash=validateHolidayData(data);
if(!args.length){console.log(JSON.stringify({valid:true,records:data.holidays.length,sources:Object.keys(data.sources).length,datasetHash}));}
else {
 const password=(await readFile(new URL('../.runtime/database-password',import.meta.url),'utf8')).trim();
 // Deliberately targets this application's local database, never the Swing database.
 const db=new PrismaClient({datasources:{db:{url:'postgresql://vcp:'+encodeURIComponent(password)+'@127.0.0.1:55432/vcp'}}});
 try {
  if(args[0]==='--apply')await db.$transaction(async tx=>{
   for(const row of data.holidays){
    const evidence=JSON.stringify({datasetHash,reviewedOn:data.reviewedOn,supersedesDate:row.supersedesDate??null,sources:row.sourceRefs.map(ref=>({ref,...data.sources[ref]})),sessionTimes:row.kind==='MUHURAT_SESSION'?'NOT_IMPORTED':null,scope:data.scope});
    await tx.$executeRaw`INSERT INTO "ExchangeHoliday" ("exchange","segment","date","name","kind","weekend","evidence") VALUES ('NSE','CM',${row.date}::date,${row.name},${row.kind},${row.weekend},${evidence}::jsonb) ON CONFLICT ("exchange","segment","date") DO NOTHING`;
    const [stored]=await tx.$queryRaw`SELECT "name","kind","weekend","evidence" FROM "ExchangeHoliday" WHERE "exchange"='NSE' AND "segment"='CM' AND "date"=${row.date}::date`;
    if(stored.name!==row.name||stored.kind!==row.kind||stored.weekend!==row.weekend||stored.evidence.datasetHash!==datasetHash)throw new Error('Existing holiday differs at '+row.date+'; review before replacing');
   }
  },{timeout:60000});
  const totals=await db.$queryRaw`SELECT EXTRACT(YEAR FROM "date")::integer AS year, COUNT(*)::integer AS records, COUNT(*) FILTER (WHERE "kind"='CLOSED')::integer AS closed, COUNT(*) FILTER (WHERE "kind"='MUHURAT_SESSION')::integer AS muhurat FROM "ExchangeHoliday" WHERE "exchange"='NSE' AND "segment"='CM' AND "date" BETWEEN DATE '2015-01-01' AND DATE '2026-12-31' GROUP BY 1 ORDER BY 1`;
  console.log(JSON.stringify({database:'vcp',table:'ExchangeHoliday',action:args[0],totals},null,2));
 } finally {await db.$disconnect();}
}
