import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PrismaClient,persistSource,ingestCandles,persistAdjustment} from '../packages/database/dist/index.js';
import {detect} from '../packages/vcp/dist/index.js';
import {Q,percentiles,sma,adv20} from '../packages/indicators/dist/index.js';
import {assertRegisteredSourceIds} from '../packages/database/dist/source-authority.js';
const folder='.runtime/official-nse/',input=JSON.parse(await readFile(folder+'prepared-scan.json','utf8')),proofs=JSON.parse(await readFile(folder+'action-bases.json','utf8'));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),at=new Date().toISOString(),provider='NSE_BHAVCOPY_IMPORT';
if(input.benchmarkGaps.length)throw new Error('Benchmark gaps prevent research scan');
const password=(await readFile('.runtime/database-password','utf8')).trim(),db=new PrismaClient({datasources:{db:{url:`postgresql://vcp:${encodeURIComponent(password)}@127.0.0.1:55432/vcp`}}});
try{
 const [batch]=await db.$queryRaw`SELECT "ownerId","sourceSnapshotId" FROM "HistoricalDataImport" WHERE id=${input.importId} AND status='COMPLETED'`;
 if(!batch)throw new Error('Import unavailable');
 await assertRegisteredSourceIds(db,'DAILY_CANDLES',[batch.sourceSnapshotId],['STORE','DERIVE','DISPLAY']);
 const source=(dataset,sourceProvider,url)=>({dataset,provider:sourceProvider,endpointOrFile:url,licenseRef:'OWNER_DECLARED_PERSONAL_USE:'+batch.ownerId+':'+at+'; public-source local research; no redistribution',uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'Pinned public-source snapshot; refresh before next scan',asOf:at,knownAt:at,effectiveAt:at,validUntil:new Date(Date.parse(at)+7*86400000).toISOString(),lastVerified:at,maximumAgeMs:7*86400000,adjustmentPolicy:'NSE verified split/bonus only; unsupported capital events excluded',coverage:{intended:input.stocks.length,available:input.stocks.filter(s=>!s.reasons.length).length},error:null});
 const actionAuthority=await persistSource(db,source('CORPORATE_ACTIONS','NSE_PUBLIC_ACTIONS','https://www.nseindia.com/api/corporates-corporateActions?index=equities'));
 const benchmarkAuthority=await persistSource(db,source('BENCHMARK','NSE_INDICES_PUBLIC','https://www.niftyindices.com/BackPage/getHistoricaldatatabletoString'));
 const calendar=(await db.calendarSnapshot.findUniqueOrThrow({where:{id:input.calendarId}})).evidence;
 calendar.forEach(Object.freeze);Object.freeze(calendar);
 const byDate=new Map(calendar.map(day=>[day.date,day])),mapping=(await db.instrumentSnapshot.findFirstOrThrow({orderBy:{knownAt:'desc'}})).evidence;
 const accepted=[],excluded=input.stocks.filter(s=>s.reasons.length).map(s=>({symbol:s.symbol,reasons:s.reasons,missing:s.missing,actions:s.unsupported.map(a=>a.subject)}));
 for(const stock of input.stocks.filter(s=>!s.reasons.length)){
  const row=mapping.rows.find(r=>r.listingId===stock.listingId&&r.isin===stock.isin);if(!row)throw new Error('Mapping changed since preparation');
  const bars=stock.bars.map(b=>({...b,listingId:stock.listingId,provider,receivedAt:at,finalizedAt:byDate.get(b.session).finalizedAt,zeroVolumeVerified:false}));
  const ingested=await ingestCandles(db,{listingId:stock.listingId,provider,bars,calendar,from:input.from,to:input.target,asOf:at});
  if(ingested.quarantined||ingested.missing.length||ingested.calendarReasons.length)throw new Error('Native ingestion did not verify '+stock.symbol);
  const originals=await db.rawDailyCandle.findMany({where:{listingId:stock.listingId,provider,session:{gte:new Date(input.from),lte:new Date(input.target)}},orderBy:{session:'asc'}});
  const raw=originals.map(b=>({listingId:stock.listingId,provider,session:b.session.toISOString().slice(0,10),open:b.open.toFixed(6),high:b.high.toFixed(6),low:b.low.toFixed(6),close:b.close.toFixed(6),volume:b.volume.toString(),revisionId:b.revisionId,receivedAt:b.receivedAt.toISOString(),finalizedAt:b.finalizedAt.toISOString(),zeroVolumeVerified:false}));
  const actions=stock.adjustments.map(a=>{
   const proof=proofs.find(p=>p.symbol===stock.symbol&&p.effective===a.session);if(!proof)throw new Error('Action raw-basis proof missing');
   return {id:hash(a),listingId:stock.listingId,kind:a.classification.kind,effectiveAt:a.session+'T03:45:00.000Z',knownAt:at,sharesAfter:a.classification.sharesAfter,sharesBefore:a.classification.sharesBefore,verified:true,sourceReference:'NSE corporate-actions record '+a.symbol+' '+a.exDate+' '+a.subject,rawBasis:{exchange:'NSE',listingId:stock.listingId,sourceReference:proof.url+' sha256:'+proof.sha256,knownAt:at,session:proof.session,close:proof.close,volume:proof.volume}};
  });
  const source={sourceSnapshotId:actionAuthority.id,id:hash({symbol:stock.symbol,actions,files:input.officialSources}),listingId:stock.listingId,knownAt:at,verified:true,sourceReference:'NSE official corporate-actions full yearly responses; hashes '+hash(input.officialSources),coverageFrom:input.from,coverageThrough:input.target,actions};
  const adjusted=await persistAdjustment(db,{listingId:stock.listingId,asOf:at,scaleSession:input.target,source,raw});if(adjusted.state!=='KNOWN')throw new Error('Adjustment not known: '+stock.symbol);
  const series={priceScale:'ADJUSTED',bars:adjusted.bars.map(b=>({...b,revision:b.rawRevisionId,endedAt:byDate.get(b.session).closesAt})),sessions:input.sessions.map(d=>d.date),asOf:at,dataRevision:adjusted.revision};
  let strength=new Q(0);for(const [days,weight] of [[20,20],[60,30],[120,30],[250,20]]){const last=series.bars.length-1,ratio=Q.decimal(series.bars[last].close).div(Q.decimal(series.bars[last-days].close)).div(Q.decimal(input.benchmark[last].close).div(Q.decimal(input.benchmark[last-days].close))).sub(new Q(1));strength=strength.add(ratio.mul(new Q(weight,100)))}
  accepted.push({symbol:stock.symbol,isin:stock.isin,listingId:stock.listingId,tick:row.tick,adjustmentId:adjusted.revision,series,strength:strength.fixed(),actions:actions.length,turnover:adv20({...series,priceScale:'RAW',bars:raw.map(b=>({...b,revision:b.revisionId,adjustmentVerified:false}))})});
  console.log(stock.symbol+' native candles and adjustments verified ('+accepted.length+')');
 }
 const intended=[...new Set(input.stocks.map(s=>s.isin).filter(Boolean))],ranks=percentiles(intended,accepted.map(s=>({isin:s.isin,value:s.strength})));
 const results=accepted.map(s=>{
  const rank=ranks.state==='KNOWN'?ranks.values[s.isin]??null:null;
  const result=detect(s.series,{listingId:s.listingId,tick:s.tick,adjustmentRevision:s.adjustmentId,currentScaleFactor:'1',rs:rank,decidedAt:at});
  const p=result.primary;
  return {symbol:s.symbol,isin:s.isin,listingId:s.listingId,adjustmentId:s.adjustmentId,close:s.series.bars.at(-1).close,sma50:sma(s.series,50).value,sma150:sma(s.series,150).value,sma200:sma(s.series,200).value,relativeStrength:s.strength,subsetPercentile:rank,actions:s.actions,turnoverEligible:s.turnover.value?.eligible??false,state:p?.state??'NO_PATTERN',patternCount:result.patterns.length,primary:p?{id:p.id,pivot:p.pivot,stopSource:p.stopSource,legs:p.legs.length,duration:p.duration,reasons:p.reasons,rules:p.rules}:null};
 });
 const report={scope:'IMPORTED_EQ_RESEARCH',profile:'IMPORTED_EQ_RESEARCH_V1',algorithm:'ST_VCP_LOCAL_EXTREMA_V1',session:input.target,from:input.from,asOf:at,importId:input.importId,sourceSnapshotIds:[batch.sourceSnapshotId,actionAuthority.id,benchmarkAuthority.id],calendarId:input.calendarId,benchmark:'NIFTY_500_PRICE',benchmarkGaps:input.benchmarkGaps,sourceFiles:input.officialSources,rankBasis:'Percentiles within imported EQ subset; NOT full NIFTY 500 rank',fullNifty500Readiness:false,executable:false,intendedCount:intended.length,analyzed:results.length,rankState:ranks.state,excluded,results};
 const id=hash(report);
 await db.$executeRaw`INSERT INTO "ImportedVcpResearchScan" (id,"ownerId","importId",session,evidence) VALUES (${id},${batch.ownerId}::uuid,${input.importId},${new Date(input.target)},${JSON.stringify(report)}::jsonb) ON CONFLICT DO NOTHING`;
 await writeFile(folder+'scan-result.json',JSON.stringify({id,...report},null,2));
 console.log(JSON.stringify({id,analyzed:results.length,excluded:excluded.length,rankState:ranks.state,states:Object.fromEntries([...new Set(results.map(r=>r.state))].map(state=>[state,results.filter(r=>r.state===state).length]))}));
}finally{await db.$disconnect()}
