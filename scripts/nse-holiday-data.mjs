import {createHash} from 'node:crypto';

export function validateHolidayData(data) {
 if(data.version!==1||data.exchange!=='NSE'||data.segment!=='CM'||data.fromYear!==2015||data.throughYear!==2026)throw new Error('Unsupported holiday dataset');
 const dates=new Set(),years=new Set();
 for(const row of data.holidays){
  const date=new Date(row.date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==row.date||date.getUTCFullYear()<2015||date.getUTCFullYear()>2026||dates.has(row.date))throw new Error('Invalid or duplicate holiday date');
  if(!row.name||!['CLOSED','MUHURAT_SESSION'].includes(row.kind)||row.weekend!==[0,6].includes(date.getUTCDay()))throw new Error('Invalid holiday classification');
  if(!row.sourceRefs?.length)throw new Error('Missing source');
  for(const ref of row.sourceRefs){
   const source=data.sources[ref],url=new URL(source?.url??'https://invalid');
   if(url.protocol!=='https:'||!['archives.nseindia.com','nsearchives.nseindia.com'].includes(url.hostname)||!/^\/[\w/]+\.pdf$/.test(url.pathname)||! /^[a-f0-9]{64}$/.test(source?.sha256??''))throw new Error('Invalid NSE source');
  }
  dates.add(row.date);years.add(date.getUTCFullYear());
 }
 if(years.size!==12)throw new Error('Missing annual coverage');
 return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
