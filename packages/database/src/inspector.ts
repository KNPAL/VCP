import type {PrismaClient} from '@prisma/client';
import {sma,ema21} from '@vcp/indicators';
import {positionEpisodes} from '@vcp/portfolio';
import {exchangeDate} from '@vcp/domain';
import type {InstrumentSnapshot} from '@vcp/market-data';
import {getDailyStructure,type DailyStructureResult} from './daily-structure.js';
import {readPortfolio} from './portfolio.js';
import type {InitialStop} from './protective-stops.js';
import {assertCandlePermissions} from './data-permissions.js';

/** Presentation indicators use the production functions on the pinned source; VCP is never re-detected. */
export function inspectorSeries(execution:DailyStructureResult){
 const source=execution.input.series,start=Math.max(0,source.bars.length-260);
 return source.bars.slice(start).map((bar,offset)=>{
  const end=start+offset+1,prefix={...source,bars:source.bars.slice(0,end),sessions:source.sessions.slice(0,end)};
  return {...bar,sma50:sma(prefix,50).value,sma150:sma(prefix,150).value,sma200:sma(prefix,200).value,ema21:ema21(prefix).value};
 });
}
export async function inspectorListings(db:PrismaClient){
 return {items:await db.$queryRaw<{id:string;listingId:string;session:string;asOf:string}[]>`SELECT DISTINCT ON ("listingId") "id","listingId",to_char("session",'YYYY-MM-DD') AS "session","evidence"->'input'->'series'->>'asOf' AS "asOf" FROM "DailyStructureExecution" WHERE "createdAt"<=clock_timestamp() AND ("evidence"->'input'->>'decidedAt')::timestamptz<=clock_timestamp() ORDER BY "listingId","session" DESC LIMIT 5000`};
}
export async function readInspector(db:PrismaClient,ownerId:string,id:string){
 const execution=await getDailyStructure(db,id);if(!execution)return null;
 const asOf=new Date().toISOString();if(Date.parse(execution.input.decidedAt)>Date.parse(asOf))return null;
 const permission=await assertCandlePermissions(db,execution.input.series.bars.map(bar=>bar.revision),['DISPLAY','DERIVE'],asOf);
 const [mappingRows,journal,stopRows,trailRows,events]=await Promise.all([
  db.$queryRaw<{evidence:InstrumentSnapshot}[]>`SELECT "evidence" FROM "InstrumentSnapshot" WHERE "knownAt"<=${new Date(execution.input.decidedAt)} ORDER BY "knownAt" DESC,"id" LIMIT 1`,
  readPortfolio(db,ownerId),
  db.$queryRaw<{evidence:InitialStop}[]>`SELECT "evidence" FROM "InitialPositionStop" WHERE "ownerId"=${ownerId}::uuid AND "evidence"->'stop'->>'listingId'=${execution.input.listingId}`,
  db.$queryRaw<{evidence:{id:string;stopId:string;input:{session:string;asOf:string;scaleVerified:boolean};result:{nextStop:string|null;effectiveAt:string|null;state:string}}}[]>`SELECT t."evidence" FROM "PositionTrail" t JOIN "InitialPositionStop" s ON s."id"=t."stopId" WHERE t."ownerId"=${ownerId}::uuid AND s."ownerId"=${ownerId}::uuid AND s."evidence"->'stop'->>'listingId'=${execution.input.listingId} ORDER BY t."session",t."decidedAt",t."id"`,
  db.$queryRaw<{evidence:NonNullable<DailyStructureResult['breakout']['event']>}[]>`SELECT "evidence" FROM "MarketEvent" WHERE "listingId"=${execution.input.listingId}::uuid AND "decidedAt"<=${new Date(execution.input.decidedAt)} ORDER BY "session","id"`
 ]);
 const listing=mappingRows[0]?.evidence.rows.find(r=>r.listingId===execution.input.listingId),isin=listing?.isin??null;
 const reversed=new Set(journal.events.flatMap(e=>e.kind==='REVERSAL'?[e.targetId]:[]));
 const bars=inspectorSeries(execution),first=bars[0]?.session??'',last=bars.at(-1)?.session??'';
 const fills=journal.events.filter(e=>e.kind==='FILL'&&e.isin===isin&&!reversed.has(e.id)&&exchangeDate(e.occurredAt)>=first&&exchangeDate(e.occurredAt)<=last).map(e=>({...e,session:exchangeDate(e.occurredAt)}));
 const episodes=positionEpisodes(journal.events,asOf).episodes;
 const stops=stopRows.map(r=>{const episode=episodes.find(e=>e.id===r.evidence.episodeId);return {...r.evidence,closedAt:episode?.closedAt??null,overlayAllowed:!!episode&&episode.fillIds.includes(r.evidence.fillId)&&r.evidence.stop?.scaleRevision===execution.input.scaleRevision}});
 const trails=trailRows.map(r=>({...r.evidence,overlayAllowed:r.evidence.input.scaleVerified&&stops.some(s=>s.id===r.evidence.stopId&&s.overlayAllowed)}));
 return {id,asOf,permission,sourceAt:execution.input.series.asOf,dataRevision:execution.input.series.dataRevision,adjustmentRevision:execution.input.adjustmentRevision,scaleRevision:execution.input.scaleRevision,configHash:execution.input.configHash,listing:listing?{listingId:listing.listingId,isin:listing.isin,symbol:listing.symbol,exchange:listing.exchange}:null,
  bars,structure:execution.detector.structure,frozen:execution.detector.frozen,breakout:execution.breakout,marketEvents:events.map(r=>r.evidence).filter(e=>e.session>=first&&e.session<=last),fills,stops,trails,
  journalAsOf:journal.asOf,priceScale:'ADJUSTED',fillPriceScale:'RAW',executable:false};
}
