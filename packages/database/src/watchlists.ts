import {randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {canonicalListings,type InstrumentSnapshot} from '@vcp/market-data';
import {ST_VCP_4_0,configurationHash,MARKET_STATE_ORDER} from '@vcp/strategy';
import {canonical} from './indicators.js';
type DB=PrismaClient|Prisma.TransactionClient;
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export function watchlistFilters(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_WATCHLIST_FILTERS');
 const row=value as Record<string,unknown>;
 if(Object.keys(row).some(k=>!['query','exchange','state'].includes(k))||(row['query']!==undefined&&(typeof row['query']!=='string'||row['query'].length>80))||(row['exchange']!==undefined&&!['ALL','NSE','BSE'].includes(String(row['exchange'])))||(row['state']!==undefined&&(typeof row['state']!=='string'||!['',...MARKET_STATE_ORDER].includes(row['state']))))throw new Error('INVALID_WATCHLIST_FILTERS');
 return {query:typeof row['query']==='string'?row['query'].trim():'',exchange:(row['exchange']??'ALL') as 'ALL'|'NSE'|'BSE',...(row['state']!==undefined?{state:row['state'] as string}:{})};
}
async function instruments(db:DB){
 const at=new Date().toISOString();
 const rows=await db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${new Date(at)} ORDER BY "knownAt" DESC,"id" LIMIT 1`;
 const source=rows[0]?.evidence;
 return {at,source,canonical:canonicalListings(source?[source]:[],source?.rows.map(r=>r.isin)??[],at)};
}
export async function watchlistInstruments(db:PrismaClient){
 const data=await instruments(db);
 return {asOf:data.at,items:data.canonical.flatMap(r=>r.primary?[{listingId:r.primary.listingId,isin:r.isin,symbol:r.primary.symbol,exchange:r.primary.exchange}]:[]),reason:data.source?null:'INSTRUMENT_MAPPING_MISSING'};
}
export async function readWatchlists(db:PrismaClient,ownerId:string){
 const lists=await db.$queryRaw<{id:string;name:string;filters:ReturnType<typeof watchlistFilters>;createdAt:Date;updatedAt:Date}[]>`SELECT "id","name","filters","createdAt","updatedAt" FROM "Watchlist" WHERE "ownerId"=${ownerId}::uuid ORDER BY "createdAt","id"`;
 const items=await db.$queryRaw<{watchlistId:string;listingId:string;evidence:{symbol:string;isin:string;exchange:string};savedAt:Date}[]>`SELECT i.* FROM "WatchlistItem" i JOIN "Watchlist" w ON w."id"=i."watchlistId" WHERE w."ownerId"=${ownerId}::uuid ORDER BY i."savedAt",i."listingId"`;
 const current=await instruments(db);
 return {asOf:current.at,items:lists.map(list=>({...list,items:items.filter(i=>i.watchlistId===list.id).map(i=>({...i,...i.evidence,researchStatus:'UNKNOWN',reason:current.canonical.some(r=>r.primary?.listingId===i.listingId)?'VERIFIED_SCAN_AND_LIVE_QUOTE_REQUIRED':'CANONICAL_MAPPING_UNAVAILABLE',quote:null}))}))};
}
export async function changeWatchlist(db:PrismaClient,ownerId:string,command:{kind:'SAVE';name:string;filters:unknown}|{kind:'ADD'|'REMOVE';id:string;listingId:string}){
 if(command.kind==='SAVE'){if(typeof command.name!=='string'||!command.name.trim()||command.name.trim().length>80)throw new Error('INVALID_WATCHLIST_NAME');watchlistFilters(command.filters)}
 else if(!uuid(command.id)||!uuid(command.listingId))throw new Error('INVALID_WATCHLIST_ID');
 return db.$transaction(async tx=>{
  // Serialize one owner's edits so duplicate adds/removals cannot duplicate audit events.
  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id"=${ownerId}::uuid FOR UPDATE`;
  let id:string,action:string,evidence:unknown,changed=false;
  if(command.kind==='SAVE'){
   const name=command.name.trim(),filters=watchlistFilters(command.filters);
   const prior=await tx.$queryRaw<{id:string;filters:unknown}[]>`SELECT "id","filters" FROM "Watchlist" WHERE "ownerId"=${ownerId}::uuid AND "name"=${name}`;
   id=prior[0]?.id??randomUUID();action=prior[0]?'FILTERS_SAVED':'CREATED';evidence={name,filters};
   if(!prior[0]){await tx.$executeRaw`INSERT INTO "Watchlist" ("id","ownerId","name","filters") VALUES (${id}::uuid,${ownerId}::uuid,${name},${canonical(filters)}::jsonb)`;changed=true}
   else if(canonical(prior[0].filters)!==canonical(filters)){await tx.$executeRaw`UPDATE "Watchlist" SET "filters"=${canonical(filters)}::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${id}::uuid`;changed=true}
  }else{
   id=command.id;
   const owned=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Watchlist" WHERE "id"=${id}::uuid AND "ownerId"=${ownerId}::uuid`;
   if(!owned.length)throw new Error('WATCHLIST_NOT_FOUND');
   action=command.kind;evidence={listingId:command.listingId};
   if(command.kind==='ADD'){
    const mapping=await instruments(tx),selected=mapping.canonical.find(r=>r.primary?.listingId===command.listingId)?.primary;
    if(!selected)throw new Error('INVALID_CANONICAL_LISTING');
    evidence={...selected,snapshotId:mapping.source!.id,asOf:mapping.at};
    changed=(await tx.$executeRaw`INSERT INTO "WatchlistItem" ("watchlistId","listingId","evidence") VALUES (${id}::uuid,${command.listingId}::uuid,${canonical(evidence)}::jsonb) ON CONFLICT DO NOTHING`)>0;
   }else changed=(await tx.$executeRaw`DELETE FROM "WatchlistItem" WHERE "watchlistId"=${id}::uuid AND "listingId"=${command.listingId}::uuid`)>0;
   if(changed)await tx.$executeRaw`UPDATE "Watchlist" SET "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${id}::uuid`;
  }
  if(changed)await tx.$executeRaw`INSERT INTO "WatchlistAudit" ("id","ownerId","watchlistId","action","evidence") VALUES (${randomUUID()}::uuid,${ownerId}::uuid,${id}::uuid,${action},${canonical({input:evidence,configHash:configurationHash(ST_VCP_4_0),researchOnly:true})}::jsonb)`;
  return {id,changed};
 });
}
