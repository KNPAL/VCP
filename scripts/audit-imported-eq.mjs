import {readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '../packages/database/dist/index.js';
const pw=(await readFile('.runtime/database-password','utf8')).trim(),db=new PrismaClient({datasources:{db:{url:`postgresql://vcp:${encodeURIComponent(pw)}@127.0.0.1:55432/vcp`}}});
try{
 const [batch]=await db.$queryRaw`SELECT id FROM "HistoricalDataImport" WHERE status='COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`;
 const equities=await db.$queryRaw`SELECT symbol,count(*)::int n,min(session)::text first,max(session)::text last FROM "HistoricalResearchBar" WHERE "importId"=${batch.id} AND series='EQ' AND quality='VALID' GROUP BY symbol ORDER BY symbol`;
 const mapping=(await db.instrumentSnapshot.findFirst({orderBy:{knownAt:'desc'}})).evidence;
 const securities=await db.$queryRaw`SELECT evidence FROM "HistoricalImportRecord" WHERE "importId"=${batch.id} AND "sourceTable"='securities' AND evidence->>'series'='EQ'`;
 const actions=[];for(let year=2020;year<=2026;year++)actions.push(...JSON.parse(await readFile('.runtime/official-nse/actions-'+year+'.json','utf8')));
 const output=equities.map(e=>{const sec=securities.find(s=>s.evidence.symbol===e.symbol)?.evidence,matched=mapping.rows.filter(r=>r.isin===sec?.isin&&r.series==='EQ');const events=actions.filter(a=>a.symbol===e.symbol);return {...e,isin:sec?.isin,listingId:matched.length===1?matched[0].listingId:null,mappedSymbol:matched.length===1?matched[0].symbol:null,listingDate:matched.length===1?matched[0].listingDate:null,actions:events.filter(a=>!/^dividend|^interim dividend|^final dividend|^special dividend|^annual general meeting|^interest payment|^income distribution/i.test(a.subject)).map(a=>({date:a.exDate,isin:a.isin,subject:a.subject}))}});
 await writeFile('.runtime/official-nse/equity-audit.json',JSON.stringify(output,null,2));console.log(JSON.stringify({eqSymbols:output.length,mapped:output.filter(r=>r.listingId).length,unmapped:output.filter(r=>!r.listingId).map(r=>r.symbol),actionSubjects:[...new Set(output.flatMap(r=>r.actions.map(a=>a.subject)))].slice(0,60)},null,2));
}finally{await db.$disconnect()}
