import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {watchlistInstruments} from './watchlists.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sources=[
 ['PortfolioJournal','position.changed',true],['InitialPositionStop','stop.changed',true],['PositionTrail','stop.changed',true],
 ['ProtectiveSignal','signal.created',true],['PartialProfitSignal','signal.created',true],['PositionFailure','signal.created',true],
 ['ExitDecision','decision.updated',true],['UserSignalDecision','decision.updated',true],['PositionMonitorEvent','data.stale',true],
 ['NotificationOutbox','alert.created',true],['MarketEvent','signal.created',false],['PatternLifecycle','pattern.changed',false],['ScanResult','scan.completed',false],
] as const;

/** Rebuildable projection of immutable evidence. The lock serializes sequence allocation and commit. */
export async function materializeStreamTimeline(db:PrismaClient){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(44108001)`;
  let inserted=0;
  for(const [table,kind,owned] of sources){
   // Identifiers come exclusively from the closed list above, never request input.
   const rows=await tx.$queryRaw<{value:Record<string,unknown>}[]>(Prisma.sql`SELECT to_jsonb(s) AS value FROM ${Prisma.raw('"'+table+'"')} s WHERE NOT EXISTS (SELECT 1 FROM "StreamTimeline" t WHERE t."id"=${table+':'}||s."id"::text) ORDER BY s."id" LIMIT 500`);
   for(const {value} of rows){
    const sourceId=String(value['id']),id=table+':'+sourceId,ownerId=owned?String(value['ownerId']):null;
    if(owned&&!/^[0-9a-f-]{36}$/.test(ownerId!))throw new Error('INVALID_STREAM_SOURCE_OWNER');
    const listingId=typeof value['listingId']==='string'?value['listingId']:null;
    const evidence=value['evidence'] as Record<string,unknown>|undefined;
    const source=([value['recordedAt'],value['decidedAt'],value['recognizedAt'],value['observedAt'],value['occurredAt'],value['asOf'],value['eventAt'],value['createdAt']].find(v=>typeof v==='string') as string|undefined)??null;
    // Future-known source records become eligible when their knowledge time arrives.
    if(source&&Date.parse(source)>Date.now())continue;
    const revision=String(value['dataRevision']??evidence?.['dataRevision']??sourceId);
    const reference={table,id:sourceId,isin:typeof value['isin']==='string'?value['isin']:null,executable:false};
    inserted+=await tx.$executeRaw`INSERT INTO "StreamTimeline" ("id","ownerId","listingId","kind","sourceAt","revision","reference") VALUES (${id},${ownerId}::uuid,${listingId}::uuid,${kind},${source?new Date(source):null},${revision},${JSON.stringify(reference)}::jsonb) ON CONFLICT ("id") DO NOTHING`;
   }
  }
  return inserted;
 },{timeout:30000});
}

export async function permittedStreamListings(db:PrismaClient,requested:readonly string[]){
 if(requested.length>100||new Set(requested).size!==requested.length||requested.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw new Error('INVALID_STREAM_LISTINGS');
 const allowed=new Set((await watchlistInstruments(db)).items.map(item=>item.listingId));
 if(requested.some(id=>!allowed.has(id)))throw new Error('STREAM_LISTING_FORBIDDEN');
 return [...requested].sort();
}

export interface StreamTimelineEvent {id:string;sequence:string;type:string;eventAt:string;sourceAt:string|null;revision:string;correlationId:string;listingId:string|null;reference:unknown;executable:false}
export async function readStreamTimeline(db:PrismaClient,ownerId:string,input:{listings?:string[];cursor?:string;limit?:number}={}){
 const listings=await permittedStreamListings(db,input.listings??[]),scope=hash([ownerId,listings]),limit=input.limit??100;
 if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('INVALID_STREAM_LIMIT');
 let after='0';
 if(input.cursor){try{if(input.cursor.length>400)throw new Error();const decoded=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(decoded.scope!==scope||typeof decoded.after!=='string'||!/^(0|[1-9]\d{0,18})$/.test(decoded.after)||BigInt(decoded.after)>9223372036854775807n)throw new Error();after=decoded.after}catch{throw new Error('INVALID_STREAM_CURSOR')}}
 const upper=await db.$queryRaw<{value:string}[]>`SELECT COALESCE(MAX("sequence"),0)::text AS value FROM "StreamTimeline"`,highWater=upper[0]!.value;
 if(BigInt(after)>BigInt(highWater))throw new Error('INVALID_STREAM_CURSOR');
 const rows=await db.$queryRaw<{id:string;sequence:bigint;kind:string;eventAt:Date;sourceAt:Date|null;revision:string;listingId:string|null;reference:unknown}[]>(Prisma.sql`SELECT * FROM "StreamTimeline" WHERE "sequence">${BigInt(after)} AND "sequence"<=${BigInt(highWater)} AND ("ownerId"=${ownerId}::uuid OR ("ownerId" IS NULL AND ("kind"='scan.completed' OR "listingId" IN (${listings.length?Prisma.join(listings.map(id=>Prisma.sql`${id}::uuid`)):Prisma.sql`NULL::uuid` })))) ORDER BY "sequence" LIMIT ${limit+1}`);
 const hasMore=rows.length>limit,selected=rows.slice(0,limit),next=hasMore?selected.at(-1)!.sequence.toString():highWater;
 const items:StreamTimelineEvent[]=selected.map(row=>({id:row.id,sequence:row.sequence.toString(),type:row.kind,eventAt:row.eventAt.toISOString(),sourceAt:row.sourceAt?.toISOString()??null,revision:row.revision,correlationId:hash(row.id),listingId:row.listingId,reference:row.reference,executable:false}));
 return {items,cursor:Buffer.from(JSON.stringify({scope,after:next})).toString('base64url'),hasMore,asOf:new Date().toISOString()};
}
