import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setupCalendar,calendarRange} from './setup-calendar.js';
import {BadRequestException} from '@nestjs/common';
import {persistSource,persistInstrumentSnapshot,persistUniverse,type PrismaClient} from '@vcp/database';
import {exchangeDate,parseFixed,formatFixed} from '@vcp/domain';
import type {InstrumentMapping,SourceRecord} from '@vcp/market-data';
import {HISTORICAL_ENDPOINT} from '@vcp/market-data';

export {catalogUrls} from '@vcp/market-data';
import {catalogUrls,sourceText} from '@vcp/market-data';
export function csvRows(text:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(value.trim());value=''}else if(c==='\n'&&!quoted){row.push(value.trim());if(row.some(Boolean))rows.push(row);row=[];value=''}else if(c!=='\r')value+=c}
 if(quoted)throw new BadRequestException('The source CSV contains an unfinished quoted field.');
 row.push(value.trim());if(row.some(Boolean))rows.push(row);
 const headers=rows.shift()?.map(h=>h.replace(/^\uFEFF/,'').trim().toUpperCase());if(!headers?.length||new Set(headers).size!==headers.length)throw new BadRequestException('Invalid CSV headers.');
 return rows.map(r=>{if(r.length!==headers.length)throw new BadRequestException('A source CSV row has the wrong number of columns.');return Object.fromEntries(headers.map((h,i)=>[h,r[i]!]))});
}
const identity=(value:string)=>{const h=createHash('sha256').update('vcp:catalog:'+value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
export function buildCatalog(master:unknown,equitiesText:string,universeText:string,asOf:string){
 if(!Array.isArray(master))throw new BadRequestException('Angel One returned an invalid instrument list.');
 const equities=csvRows(equitiesText),members=csvRows(universeText),day=exchangeDate(asOf);
 // Official membership can temporarily exceed 500 following corporate actions.
 if(members.length<450||members.length>550)throw new BadRequestException('The NIFTY 500 file has an unexpected member count. No data was imported.');
 const seen=new Set<string>(),rows:InstrumentMapping[]=[],problems:string[]=[];
 for(const member of members){
  const symbol=member['SYMBOL'],isin=member['ISIN CODE'];
  if(!symbol||!isin||seen.has(isin))throw new BadRequestException('The NIFTY 500 file has missing or duplicate identities.');
  if(!/^IN[A-Z0-9]{9}[0-9]$/.test(isin)){problems.push(symbol+': placeholder or unsupported ISIN; excluded');continue}
  seen.add(isin);if(member['SERIES']!=='EQ'){problems.push(symbol+': '+member['SERIES']+' series is not supported cash equity; excluded');continue}
  const eq=equities.filter(e=>e['SYMBOL']===symbol&&e['ISIN NUMBER']===isin&&e['SERIES']==='EQ');
  const broker=master.filter(r=>r&&typeof r==='object'&&['NSE','NSE_CM'].includes(String(r.exch_seg).toUpperCase())&&r.symbol===symbol+'-EQ'&&['','EQ'].includes(r.instrumenttype)&&r.expiry==='');
  if(eq.length!==1||broker.length!==1){problems.push(symbol+': missing or ambiguous NSE / Angel One match');continue}
  const raw=broker[0],match=/^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(eq[0]!['DATE OF LISTING']??''),months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  if(!match||!months.includes(match[2]!.toUpperCase())){problems.push(symbol+': listing date unavailable');continue}
  const listingDate=`${match[3]}-${String(months.indexOf(match[2]!.toUpperCase())+1).padStart(2,'0')}-${match[1]}`;
  if(new Date(listingDate).toISOString().slice(0,10)!==listingDate||listingDate>day||!/^\d+$/.test(raw.token)||!/^\d+$/.test(raw.lotsize))throw new BadRequestException('Invalid broker token, lot or listing date.');
  const tick=parseFixed(raw.tick_size);if(tick<=0n||tick%100n!==0n)throw new BadRequestException('Invalid Angel One tick size.');
  rows.push({companyId:identity(isin),listingId:identity(isin+':NSE'),isin,exchange:'NSE',series:'EQ',symbol:raw.symbol,instrumentType:'EQUITY',tick:formatFixed(tick/100n),lot:Number(raw.lotsize),listingDate,provider:'ANGEL_ONE',token:raw.token,validFrom:day,validTo:null,verified:true,enabled:true});
 }
 if(rows.length<400)throw new BadRequestException('Too few stock identities could be matched. No import was made. '+problems.slice(0,5).join('; '));
 return {rows,isins:[...seen],day,excluded:problems};
}
export type SetupReferences={confirmed:boolean};
function references(value:unknown):SetupReferences{
 const r=value as SetupReferences;
 if(!r||Object.keys(r).some(k=>k!=='confirmed')||r.confirmed!==true)throw new BadRequestException('Confirm personal research use before initializing data.');return r;
}

export async function initializeCatalog(db:PrismaClient,ownerId:string,value:unknown){
 const active=await db.$queryRaw<{id:string}[]>`SELECT id FROM "ManualDownloadRun" WHERE state IN ('QUEUED','RUNNING','PAUSED_QUOTA','CANCEL_REQUESTED') LIMIT 1`;
 if(active.length)throw new BadRequestException('A download is active. Wait for it to finish or cancel it before refreshing market data.');
 references(value);let texts:string[];try{texts=await Promise.all([sourceText(catalogUrls.angel,40*1024*1024),sourceText(catalogUrls.equities,2*1024*1024),sourceText(catalogUrls.universe,2*1024*1024)])}catch(error){throw new BadRequestException(error instanceof Error?error.message:'Unable to fetch stock reference files.')}const asOf=new Date().toISOString();
 let master:unknown;try{master=JSON.parse(texts[0]!)}catch{throw new BadRequestException('Angel One did not return valid instrument JSON.');}
 const catalog=buildCatalog(master,texts[1]!,texts[2]!,asOf),digest=createHash('sha256').update(JSON.stringify(texts)).digest('hex');
 const nowActive=await db.$queryRaw<{id:string}[]>`SELECT id FROM "ManualDownloadRun" WHERE state IN ('QUEUED','RUNNING','PAUSED_QUOTA','CANCEL_REQUESTED') LIMIT 1`;
 if(nowActive.length)throw new BadRequestException('A download started while sources were loading. Finish that download before refreshing data.');
 // Existing company/listing identities must survive refreshes.
 const companies=await db.company.findMany({where:{isin:{in:catalog.isins}}}),existingListings=await db.listing.findMany({where:{companyId:{in:companies.map(c=>c.id)},exchange:'NSE'}});
 for(const row of catalog.rows){const existing=companies.find(c=>c.isin===row.isin);if(existing){row.companyId=existing.id;const listings=existingListings.filter(l=>l.companyId===existing.id);if(listings.length>1)throw new BadRequestException('Existing NSE listing identities are ambiguous.');row.listingId=listings[0]?.id??row.listingId}}
 const declaration='OWNER_DECLARED_PERSONAL_USE:'+ownerId+':'+asOf+'; no reviewed agreement; no redistribution';
 const source=(dataset:string,provider:string,url:string):SourceRecord=>({dataset,provider,endpointOrFile:url,licenseRef:declaration,uses:{DOWNLOAD:true,STORE:true,DERIVE:true,DISPLAY:true,REDISTRIBUTE:false},updateFrequency:'Refresh before use; current constituent snapshot only',asOf,knownAt:asOf,effectiveAt:asOf,validUntil:new Date(Date.parse(asOf)+7*86400000).toISOString(),lastVerified:asOf,maximumAgeMs:7*86400000,adjustmentPolicy:'Unadjusted reference metadata; current mappings only',coverage:{intended:catalog.isins.length,available:catalog.rows.length},error:null});
 const instrumentSource=source('instrument-master','ANGEL_ONE',catalogUrls.angel),universeSource=source('UNIVERSE','NSE',catalogUrls.universe);
 await persistSource(db,instrumentSource);await persistSource(db,universeSource);
 await persistSource(db,source('DAILY_CANDLES','ANGEL_ONE',HISTORICAL_ENDPOINT));
 const calendarSource=await persistSource(db,source('EXCHANGE_CALENDAR','NSE','https://www.nseindia.com/static/market-data/market-timings'));
 const holidays=JSON.parse(await readFile(new URL('../../../data/nse-cm-holidays-2015-2026.json',import.meta.url),'utf8'));
 const calendar=setupCalendar(holidays.holidays,asOf,calendarSource.id),calendarJson=JSON.stringify(calendar),calendarHash=createHash('sha256').update(calendarJson).digest('hex');
 const mapping=await persistInstrumentSnapshot(db,{knownAt:asOf,sourceReference:JSON.stringify({digest,ownerId,urls:catalogUrls,excluded:catalog.excluded}),source:instrumentSource,rows:catalog.rows});
 // Verified for today's selection only; never backdate current membership for backtests.
 const universe=await persistUniverse(db,{universe:'NIFTY_500',knownAt:asOf,effectiveFrom:catalog.day,effectiveTo:null,sourceReference:digest,source:universeSource,historicalConstituentsVerified:true,isins:catalog.isins});
 await db.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "CalendarSnapshot" (id,evidence) VALUES (${calendarHash},${calendarJson}::jsonb) ON CONFLICT DO NOTHING`;
  for(const row of catalog.rows){
   const evidence=JSON.stringify({state:'NOT_DOWNLOADED',calendarHash,calendarFrom:calendarRange.from,calendarTo:calendarRange.to,bootstrap:true,expectedCount:null,actualResponseCount:0,missing:[],calendarReasons:[],inserted:0,revised:0,unchanged:0,quarantined:0,watermark:null,changes:[]});
   await tx.$executeRaw`INSERT INTO "CandleCoverage" ("listingId",provider,"fromSession","watermark","checkedAt",evidence) VALUES (${row.listingId}::uuid,'ANGEL_ONE',${new Date(calendarRange.from)},NULL,${new Date(asOf)},${evidence}::jsonb) ON CONFLICT ("listingId",provider) DO UPDATE SET evidence=jsonb_set("CandleCoverage".evidence,'{calendarHash}',to_jsonb(${calendarHash}::text)),"checkedAt"=${new Date(asOf)}`;
  }
 },{timeout:60000});
 return {stockCount:catalog.rows.length,excluded:catalog.excluded,asOf,mappingId:mapping.id,universeId:universe.id,calendarRange,message:'Stock selection and the supported daily calendar are initialized. '+catalog.excluded.length+' source entries were excluded; review the list before downloading. An active broker session is required.'};
}
